// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The ALMOR text serializer. `serializeAlmor(db)` emits ALMOR_Text from a
// `MorphologyDb` — the eleven sections in the order the parser walks them
// (DEFINES, DEFAULTS, ORDER, TOKENIZATIONS, STEMBACKOFF, PREFIXES, SUFFIXES,
// STEMS, TABLE AB, TABLE BC, TABLE AC) — such that
// `parseAlmor(serializeAlmor(db))` yields a model equal to `db`, with
// `defines` values compared as sets (order does not survive, only membership
// is ever read) and every other structure compared exactly. It closes the
// parser's round trip and is the compiler's round-trip check.
//
// This is a new-design file: the serializer has no upstream counterpart (CAMeL
// Tools' `MorphologyDB` never writes ALMOR text back). Project header only, no
// ported-code notice.
//
// The emission mirrors `parseAlmor`'s tokenization exactly so the round trip
// closes:
//   - header sections are space-separated and the parser strips each line, so
//     the surrounding newlines are the only separators that matter;
//   - affix and stem lines are tab-separated into surface, category and the
//     space-joined `key:value` features, in feature insertion order;
//   - table pairs are two whitespace-separated tokens, one per line.
// It never calls `trim`/`\s`/`\d`; the one join below is on literal `'\n'`,
// `'\t'` and `' '`, which are plain string constants, not whitespace classes.
//
// `computeFeats` is not emitted: the parser recomputes it from `ORDER` at the
// `###TOKENIZATIONS###` marker, so it round-trips through `order`. A stem's
// `lex` was already reduced by `stripLex` at parse time, so round-trip
// equality holds on the stripped value, which is what the model carries.
//
// Generation side. The surfaces come from the analysis-side indexes, so a
// model without `flags.analysis` is refused with `DatabaseError`.
//
// The tuple model. The serializer reads the model's entry tables, which hold
// each section's lines in line order, and emits them in that order; the
// generation tables, which index the same tables, round-trip with them. The
// compatibility tables are emitted from their pair lists, rows in first-seen
// order and pairs in line order.

import type { PairOrder, CategoryRole } from './compat-bitset.js';
import { type MorphologyDb, tupleModelOf, type TupleModel } from './database.js';
import type { EntryTable, IdArray, KeyIndex } from './feature-schema.js';
import { DatabaseError } from './errors.js';

/**
 * Serialize a {@link MorphologyDb} to ALMOR_Text that `parseAlmor` reads back
 * into an equal model (defines as sets, everything else exact). The emitted
 * text is not the input's bytes, only a text that parses to an equal model.
 *
 * @throws {DatabaseError} for a model without `flags.analysis`.
 */
export function serializeAlmor(db: MorphologyDb): string {
  const model = tupleModelOf(db);
  if (!db.flags.analysis) {
    throw new DatabaseError(
      'cannot serialize a database parsed without the analysis flag',
    );
  }

  const lines: string[] = [];

  // --- DEFINES. `DEFINE <name> <name>:<value> …`; an open class (value
  // `null`) is `DEFINE <name> <name>:*open*`. The parser only treats `*open*`
  // as the open-class marker on a line of exactly three tokens, so a lone
  // `<name>:*open*` value is required and sufficient. A non-open define always
  // carries at least one value (the parser rejects a two-token DEFINE line),
  // so no empty value list is emitted.
  lines.push('###DEFINES###');
  for (const [name, values] of db.defines) {
    if (values === null) {
      lines.push(`DEFINE ${name} ${name}:*open*`);
    } else {
      const toks = values.map((value) => `${name}:${value}`);
      lines.push(`DEFINE ${name} ${toks.join(' ')}`);
    }
  }

  // --- DEFAULTS. `DEFAULT <feat>:<value|*> …` in `defaults` insertion order;
  // a `null` value is emitted as `*`, which the parser maps back to `null`.
  // Each row carries its `pos` feature (the parser keys on it and rejects a
  // row without one), so the key is recoverable from the row itself.
  lines.push('###DEFAULTS###');
  for (const row of db.defaults.values()) {
    const toks = Object.entries(row).map(
      ([feat, value]) => `${feat}:${value === null ? '*' : value}`,
    );
    lines.push(`DEFAULT ${toks.join(' ')}`);
  }

  // --- ORDER. One `ORDER <feat> …` line (the parser keeps the last ORDER
  // line, so a single line reproduces the stored list). Omitted entirely when
  // the section was absent (`order` is `null`): the parser leaves `order`
  // `null` when it sees no ORDER line before the TOKENIZATIONS marker.
  lines.push('###ORDER###');
  if (db.order !== null) {
    lines.push(`ORDER ${db.order.join(' ')}`);
  }

  // --- TOKENIZATIONS. `TOKENIZATION <feat> …`; the parser adds `slice(1)` of
  // each line to the set, so one line listing the whole set reproduces it. An
  // empty set emits no line. `computeFeats` is not emitted here — the parser
  // fills it from `order` at this marker.
  lines.push('###TOKENIZATIONS###');
  if (db.tokenizations.size > 0) {
    lines.push(`TOKENIZATION ${[...db.tokenizations].join(' ')}`);
  }

  // --- STEMBACKOFF. `STEMBACKOFF <action> <category> …`, one line per action.
  lines.push('###STEMBACKOFF###');
  for (const [action, categories] of db.stemBackoffs) {
    lines.push(`STEMBACKOFF ${action} ${categories.join(' ')}`);
  }

  // --- PREFIXES / SUFFIXES / STEMS. `surface\tcategory\tkey:value …`, one
  // line per entry in line order, features in Layout order. The parser strips
  // the surface (so a surface with surrounding whitespace would not
  // round-trip; parsed surfaces are already stripped) and keeps the category
  // and feature values verbatim.
  const h = model.header;
  lines.push('###PREFIXES###');
  appendTable(lines, model, h.prefixes, h.prefixIndex as KeyIndex, h.prefixCats);

  lines.push('###SUFFIXES###');
  appendTable(lines, model, h.suffixes, h.suffixIndex as KeyIndex, h.suffixCats);

  lines.push('###STEMS###');
  appendTable(lines, model, model.stem.stems, model.stem.stemIndex as KeyIndex, h.stemCats);

  // --- The three compatibility tables. `left right`, one pair per line, each
  // left category followed by each of its right categories. The parser splits
  // on any whitespace run and requires exactly two tokens.
  lines.push('###TABLE AB###');
  appendPairs(lines, model, h.abOrder, h.prefixCats, h.stemCats);

  lines.push('###TABLE BC###');
  appendPairs(lines, model, h.bcOrder, h.stemCats, h.suffixCats);

  lines.push('###TABLE AC###');
  appendPairs(lines, model, h.acOrder, h.prefixCats, h.suffixCats);

  // A trailing newline so `pyLines` sees a terminated final line, matching the
  // documents the parser is fed.
  return lines.join('\n') + '\n';
}

/**
 * Append the lines of an affix or stem section, one per entry in line order:
 * `surface\tcategory\tfeatures`, the features joined as space-separated
 * `key:value` pairs in Layout order. Each entry's surface is read off the
 * surface index.
 */
function appendTable(
  lines: string[],
  model: TupleModel,
  table: EntryTable,
  index: KeyIndex,
  role: CategoryRole,
): void {
  const strings = model.strings.strings;
  const names = model.header.schema.names;
  const surfaceOf = new Array<string>(table.count);
  for (const [surface, slot] of index.slots) {
    for (let k = index.start[slot] as number; k < (index.start[slot + 1] as number); k++) {
      surfaceOf[index.ids[k] as number] = surface;
    }
  }
  for (let e = 0; e < table.count; e++) {
    const keys = model.header.schema.layouts[table.layout[e] as number] as IdArray;
    const base = table.valueStart[e] as number;
    const feats: string[] = [];
    for (let p = 0; p < keys.length; p++) {
      feats.push(`${names[keys[p] as number] as string}:${strings[table.values[base + p] as number] as string}`);
    }
    const category = strings[role.names[table.category[e] as number] as number] as string;
    lines.push(`${surfaceOf[e] as string}\t${category}\t${feats.join(' ')}`);
  }
}

/** Append a compatibility table: `left right` per pair, rows in first-seen order, pairs in line order. */
function appendPairs(
  lines: string[],
  model: TupleModel,
  order: PairOrder,
  left: CategoryRole,
  right: CategoryRole,
): void {
  const strings = model.strings.strings;
  for (let r = 0; r < order.rows.length; r++) {
    const l = strings[left.names[order.rows[r] as number] as number] as string;
    for (let k = order.start[r] as number; k < (order.start[r + 1] as number); k++) {
      lines.push(`${l} ${strings[right.names[order.ids[k] as number] as number] as string}`);
    }
  }
}
