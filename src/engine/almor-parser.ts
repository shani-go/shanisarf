// Ported from CAMeL Tools morphology/database.py (version 1.6.0).
// Copyright 2018-2026 New York University Abu Dhabi. MIT License.
// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.
// shanisarf's changes are Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
//
// The ALMOR text parser. `parseAlmor(text, { flags })` walks `pyLines(text)`
// (as `textLines`, which splits the same way without a RegExp) with one
// forward cursor through the eleven sections of ALMOR_Text — DEFINES,
// DEFAULTS, ORDER, TOKENIZATIONS, STEMBACKOFF, PREFIXES, SUFFIXES, STEMS,
// TABLE AB, TABLE BC, TABLE AC, in that order — reproducing CAMeL Tools'
// `MorphologyDB._parse_dbfile` loop by loop: each section's exact
// tokenization (`pySplitOn`, never a JavaScript whitespace split), its
// terminator marker, and the `DatabaseParseError` it raises. The `a`, `g` and
// `r` flags select the tables built, as upstream's do: analysis builds the
// surface hashes, TABLE AB and the affix size bounds; generation builds the
// category hashes, the lemma hash and TABLE AB transposed; TABLE BC and AC
// are built whatever the flags. The generation tables share the
// analysis-side records and never mutate them.
//
// The model. The walk feeds a `ModelBuilder`: each affix and stem line becomes
// an entry of its section's table, in line order (a category id, its keys by
// first occurrence and each key's last value as string ids), indexed by
// surface under analysis and by `lex` under generation; table lines become
// role-id pairs. Every string is interned in the String_Table, whose copies
// never reference the source text. Feature and category names are interned
// into the header range, and the header range closes at the `###STEMS###`
// marker. The header sections are built as Maps over the table's copies.
//
// Where upstream would raise an unhandled Python `KeyError` or
// `IndexError`, the port is defined: a one-token `ORDER` or `TOKENIZATION`
// line and a stem line without `lex` are `DatabaseParseError`s; each such site
// carries a comment naming the upstream line. The Database_Pin triggers none
// of them.

import {
  type DatabaseFlags,
  MODEL,
  ModelBuilder,
  MorphologyDb,
  readDatabaseFlags,
} from './database.js';
import { DatabaseParseError } from './errors.js';
import type { EntryTableBuilder } from './feature-schema.js';
import { freshCopy } from './string-table.js';
import { stripLex } from './features.js';
import {
  PY_WHITESPACE,
  pyLen,
  pyRepr,
  pySplit,
  pySplitOn,
  pyStrip,
} from './python-compat.js';

/** Options for {@link parseAlmor}. Defaults to the analysis flag string. */
export interface ParseAlmorOptions {
  flags?: string;
}

/**
 * Parse ALMOR_Text into a {@link MorphologyDb}.
 *
 * The port of upstream's `MorphologyDB(fpath, flags)` constructor and
 * `_parse_dbfile`. `text` is the whole database as a string (a Node caller
 * reads the file; the engine has no `loadDatabase`); `flags` defaults to
 * `'a'`.
 *
 * @throws {InvalidDatabaseFlagError} naming the first character of `flags`
 *   that is not `a`, `g` or `r`.
 * @throws {DatabaseParseError} on a malformed section line, with
 *   upstream's `Error parsing database (<detail>)` message.
 */
export function parseAlmor(
  text: string,
  options: ParseAlmorOptions = {},
): MorphologyDb {
  // Flags, one character at a time as upstream reads them
  // (`readDatabaseFlags`): 'a' sets analysis,
  // 'g' generation, 'r' both; any other character is refused, as upstream's
  // `else: raise InvalidDatabaseFlagError(flag)`.
  const dbFlags: DatabaseFlags = readDatabaseFlags(options.flags ?? 'a');
  const withAnalysis = dbFlags.analysis;
  const withGeneration = dbFlags.generation;

  const defines = new Map<string, string[] | null>();
  const defaults = new Map<string | null, Record<string, string | null>>();
  let order: string[] | null = null;
  const tokenizations = new Set<string>();
  let computeFeats = new Set<string>();
  const stemBackoffs = new Map<string, string[]>();

  const model = new ModelBuilder(dbFlags);
  const strings = model.strings;
  const intern = (s: string): string => strings.copy(s);
  const prefixCache = new TokenCache();
  const suffixCache = new TokenCache();
  const stemCache = new TokenCache();
  const prefixLine = new LineCache();
  const suffixLine = new LineCache();
  const stemLine = new LineCache();

  const lines = textLines(text);
  // One forward cursor. Each section loop reads lines until it meets its
  // terminator marker; reaching the marker both ends the section and consumes
  // the marker line (mirroring upstream's `for line in dbfile: ... break`,
  // which leaves the file positioned after the marker).
  let i = 0;

  // --- DEFINES: skip `###DEFINES###`, stop at `###DEFAULTS###`.
  while (i < lines.length) {
    const line = pyStrip(lines[i] as string);
    i++;

    if (line === '###DEFINES###') {
      continue;
    }
    if (line === '###DEFAULTS###') {
      break;
    }

    const toks = pySplitOn(line, ' ');

    if (toks.length < 3 || toks[0] !== 'DEFINE') {
      throw new DatabaseParseError(`invalid DEFINES line ${pyRepr(line)}`);
    }

    const name = toks[1] as string;
    let valSet: string[] | null = [];

    for (const tok of toks.slice(2)) {
      const subtoks = pySplitOn(tok, ':');

      // Upstream: `if len(subtoks) != 2 and subtoks[0] != toks[1]` -> error.
      if (subtoks.length !== 2 && subtoks[0] !== name) {
        throw new DatabaseParseError(
          `invalid key value pair ${pyRepr(tok)} in DEFINES`,
        );
      }

      // Open class: only when the whole line is exactly three tokens and this
      // value is `*open*` (upstream `if len(toks) == 3 and subtoks[1] ==
      // '*open*'`). `*open*` on a longer line is added as an ordinary value —
      // upstream's quirk, kept.
      if (toks.length === 3 && subtoks[1] === '*open*') {
        valSet = null;
        break;
      }

      // `subtoks[1]` is the value; it may be `undefined` only on a malformed
      // one-part token whose sole part equals the define name (the guard above
      // let it through). Upstream would store `None` into a Python set there;
      // the Database_Pin never does this, and the push below records the
      // string value for every well-formed line.
      const value = subtoks[1];
      valSet.push(value === undefined ? (value as unknown as string) : intern(value));
    }

    // Values kept in first-seen order; upstream's is Python set order and only
    // membership is ever read.
    defines.set(intern(name), valSet);
    // The Feature_Name list starts with the defines, in DEFINES order.
    model.featureId(name);
  }

  // --- DEFAULTS: stop at `###ORDER###`.
  while (i < lines.length) {
    const line = pyStrip(lines[i] as string);
    i++;

    if (line === '###ORDER###') {
      break;
    }

    const toks = pySplitOn(line, ' ');

    if (toks.length < 2 || toks[0] !== 'DEFAULT') {
      throw new DatabaseParseError(`invalid DEFAULTS line ${pyRepr(line)}`);
    }

    const parsed = parseDefaultsLineToks(toks.slice(1));

    // Keyed by `pos` (upstream's `_defaultKey`); a row without `pos` is an
    // error.
    if (!Object.prototype.hasOwnProperty.call(parsed, 'pos')) {
      throw new DatabaseParseError(
        `DEFAULTS line ${pyRepr(line)} missing pos value`,
      );
    }

    // The row rebuilt over the table's copies; `Object.entries` gives its keys
    // in first-assignment order with their final values.
    const row: Record<string, string | null> = {};
    for (const [feat, val] of Object.entries(parsed)) {
      row[intern(feat)] = val === null ? null : intern(val);
    }
    const dkey = row['pos'] as string | null;
    defaults.set(dkey, row);
  }

  // --- ORDER: stop at `###TOKENIZATIONS###`, fixing `computeFeats` there.
  while (i < lines.length) {
    const line = pyStrip(lines[i] as string);
    i++;

    if (line === '###TOKENIZATIONS###') {
      // `pattern` is computed at merge time: the compute set is exactly the
      // ORDER list seen so far.
      computeFeats = new Set(order ?? []);
      break;
    }

    const toks = pySplitOn(line, ' ');

    // Upstream's guard `self.order is not None and len(toks) < 2 and toks[0]
    // != 'ORDER'` is inert on the first line (order is None) and an
    // `IndexError` on `toks[1]` would follow a one-token line. Defined here as
    // a parse error (upstream morphology/database.py "Process ORDER").
    if (toks.length < 2) {
      throw new DatabaseParseError(`invalid ORDER line ${pyRepr(line)}`);
    }

    // Only `toks[1]` is checked against `defines`, as upstream.
    if (!defines.has(toks[1] as string)) {
      throw new DatabaseParseError(
        `invalid feature ${pyRepr(toks[1] as string)} in ORDER line.`,
      );
    }

    // Last line wins.
    order = toks.slice(1).map(intern);
  }

  // --- TOKENIZATIONS: stop at `###STEMBACKOFF###`.
  while (i < lines.length) {
    const line = pyStrip(lines[i] as string);
    i++;

    if (line === '###STEMBACKOFF###') {
      break;
    }

    const toks = pySplitOn(line, ' ');

    // Same inert upstream guard as ORDER; a one-token line is a parse error
    // here (upstream "Process TOKENIZATIONS").
    if (toks.length < 2) {
      throw new DatabaseParseError(
        `invalid TOKENIZATION line ${pyRepr(line)}`,
      );
    }

    if (!defines.has(toks[1] as string)) {
      throw new DatabaseParseError(
        `invalid feature ${pyRepr(toks[1] as string)} in TOKENIZATION line.`,
      );
    }

    for (const feat of toks.slice(1)) {
      tokenizations.add(intern(feat));
    }
  }

  // --- STEMBACKOFF: stop at `###PREFIXES###`.
  while (i < lines.length) {
    const line = pyStrip(lines[i] as string);
    i++;

    if (line === '###PREFIXES###') {
      break;
    }

    const toks = pySplitOn(line, ' ');

    if (toks.length < 3 || toks[0] !== 'STEMBACKOFF') {
      throw new DatabaseParseError(
        `invalid STEMBACKOFFS line ${pyRepr(line)}`,
      );
    }

    stemBackoffs.set(intern(toks[1] as string), toks.slice(2).map(intern));
  }

  // --- PREFIXES: the line is NOT stripped; split on tab; stop at
  // `###SUFFIXES###`.
  while (i < lines.length) {
    const line = lines[i] as string;
    i++;

    // `pySplitOn(line, '\t')` into exactly three parts, read as ranges.
    const tab1 = line.indexOf('\t');
    const tab2 = tab1 === -1 ? -1 : line.indexOf('\t', tab1 + 1);
    if (tab2 === -1 || line.indexOf('\t', tab2 + 1) !== -1) {
      if (pyStrip(line) === '###SUFFIXES###') {
        break;
      }
      throw new DatabaseParseError(`invalid PREFIXES line ${pyRepr(line)}`);
    }

    // The surface and features stripped, the category unstripped, as upstream.
    const [surfaceStart, surfaceEnd] = pyStripRange(line, 0, tab1);
    const [featsStart, featsEnd] = pyStripRange(line, tab2 + 1, line.length);
    model.prefixes.begin();
    parseAnalysisLineToks(line, featsStart, featsEnd, model, model.prefixes, prefixCache);
    const id = model.prefixes.end(
      prefixLine.role(line, tab1 + 1, tab2, strings, (name) => model.prefixCategory(name)),
    );
    if (withAnalysis) {
      model.prefixSurfaces.add(prefixLine.surfaceOf(line, surfaceStart, surfaceEnd, strings), id);
    }
  }

  // --- SUFFIXES: identical shape to PREFIXES; stop at `###STEMS###`.
  while (i < lines.length) {
    const line = lines[i] as string;
    i++;

    const tab1 = line.indexOf('\t');
    const tab2 = tab1 === -1 ? -1 : line.indexOf('\t', tab1 + 1);
    if (tab2 === -1 || line.indexOf('\t', tab2 + 1) !== -1) {
      if (pyStrip(line) === '###STEMS###') {
        break;
      }
      throw new DatabaseParseError(`invalid SUFFIXES line ${pyRepr(line)}`);
    }

    const [surfaceStart, surfaceEnd] = pyStripRange(line, 0, tab1);
    const [featsStart, featsEnd] = pyStripRange(line, tab2 + 1, line.length);
    model.suffixes.begin();
    parseAnalysisLineToks(line, featsStart, featsEnd, model, model.suffixes, suffixCache);
    const id = model.suffixes.end(
      suffixLine.role(line, tab1 + 1, tab2, strings, (name) => model.suffixCategory(name)),
    );
    if (withAnalysis) {
      model.suffixSurfaces.add(suffixLine.surfaceOf(line, surfaceStart, surfaceEnd, strings), id);
    }
  }

  // Strings first seen from here on are Stem_Part strings.
  strings.endHeader();

  // --- STEMS: stripped; split on tab; stop at `###TABLE AB###`. There is no
  // marker check on a non-3-part line here (upstream raises directly).
  while (i < lines.length) {
    const line = pyStrip(lines[i] as string);
    i++;

    if (line === '###TABLE AB###') {
      break;
    }

    const tab1 = line.indexOf('\t');
    const tab2 = tab1 === -1 ? -1 : line.indexOf('\t', tab1 + 1);
    if (tab2 === -1 || line.indexOf('\t', tab2 + 1) !== -1) {
      throw new DatabaseParseError(`invalid STEMS line ${pyRepr(line)}`);
    }

    // Upstream splits `parts[2]` on ' ' without stripping it first (unlike the
    // affix sections). `parseAnalysisLineToks` skips empty tokens, so a
    // trailing space is harmless. Each `lex` value is stored stripped
    // (`stripLex`), so the raw lemma is never interned.
    model.stems.begin();
    parseAnalysisLineToks(line, tab2 + 1, line.length, model, model.stems, stemCache, 'lex');

    // Upstream: `analysis['lex'] = strip_lex(analysis['lex'])`, done above per
    // token: the last `lex` token's stripped value is the one kept, at the
    // first one's position, as on the dictionary. A stem line without a `lex`
    // feature is a Python `KeyError` upstream; defined here as a parse error
    // (upstream "Process STEMS").
    const lexFeature = model.schema.ids.get('lex');
    const lex = lexFeature === undefined ? -1 : model.stems.valueOf(lexFeature);
    if (lex === -1) {
      throw new DatabaseParseError(`invalid STEMS line ${pyRepr(line)}`);
    }

    const id = model.stems.end(stemLine.role(line, tab1 + 1, tab2, strings, (name) => model.stemCategory(name)));
    if (withAnalysis) {
      model.stemSurfaces.add(stemLine.surfaceOf(line, 0, tab1, strings), id);
    }
    if (withGeneration) {
      // Upstream also writes `analysis['stemcat'] = category` into the shared
      // stem dictionary here; the port does not, so the analysis-side records
      // stay unmutated: the Generator builds the Stem_View
      // `{ ...features, stemcat }` per visited stem.
      model.lemmas.add(strings.string(lex), id);
    }
  }

  // --- TABLE AB (prefix-stem): stripped; `pySplit` (any whitespace); stop at
  // `###TABLE BC###`.
  while (i < lines.length) {
    const line = pyStrip(lines[i] as string);
    i++;

    if (line === '###TABLE BC###') {
      break;
    }

    const toks = pySplit(line);

    if (toks.length !== 2) {
      throw new DatabaseParseError(`invalid TABLE AB line ${pyRepr(line)}`);
    }

    const left = model.prefixCategory(toks[0] as string);
    const right = model.stemCategory(toks[1] as string);
    if (withAnalysis) {
      model.ab.add(left, right);
    }
    if (withGeneration) {
      model.abTransposed.add(right, left);
    }
  }

  // --- TABLE BC (stem-suffix): stop at `###TABLE AC###`.
  while (i < lines.length) {
    const line = pyStrip(lines[i] as string);
    i++;

    if (line === '###TABLE AC###') {
      break;
    }

    const toks = pySplit(line);

    if (toks.length !== 2) {
      throw new DatabaseParseError(`invalid TABLE BC line ${pyRepr(line)}`);
    }

    model.bc.add(model.stemCategory(toks[0] as string), model.suffixCategory(toks[1] as string));
  }

  // --- TABLE AC (prefix-suffix): runs to the end of the text.
  while (i < lines.length) {
    const line = pyStrip(lines[i] as string);
    i++;

    const toks = pySplit(line);

    if (toks.length !== 2) {
      throw new DatabaseParseError(`invalid TABLE AC line ${pyRepr(line)}`);
    }

    model.ac.add(model.prefixCategory(toks[0] as string), model.suffixCategory(toks[1] as string));
  }

  // Affix size bounds: the greatest code-point length of any prefix or suffix
  // surface. `pyLen` counts code points, not UTF-16 code units. Without
  // analysis the surface hashes are empty and both bounds stay 0, as upstream
  // computes them only under `_withAnalysis`.
  let maxPrefixSize = 0;
  for (const surface of model.prefixSurfaces.slots.keys()) {
    maxPrefixSize = Math.max(maxPrefixSize, pyLen(surface));
  }
  let maxSuffixSize = 0;
  for (const surface of model.suffixSurfaces.slots.keys()) {
    maxSuffixSize = Math.max(maxSuffixSize, pyLen(surface));
  }

  return new MorphologyDb({
    [MODEL]: model.finish(
      { flags: dbFlags, defines, defaults, order, tokenizations, computeFeats, stemBackoffs },
      maxPrefixSize,
      maxSuffixSize,
    ),
  });
}

/**
 * `pyLines(text)` without a regular expression: split on `\r\n`, `\r` and
 * `\n` alike and drop the final empty piece; `''` yields `[]`.
 *
 * `pyLines` splits with a RegExp, and V8 keeps the subject of the last
 * successful match alive for the legacy `RegExp.input`. Over the whole
 * source text that keeps the text alive after the parser returns, until some
 * later match replaces it, which would undo the String_Table's fresh copies
 * String patterns leave it alone.
 */
export function textLines(text: string): string[] {
  if (text === '') {
    return [];
  }
  // A `\r\n` pair becomes one `\n`; every `\r` left is a lone terminator.
  const unified = text.includes('\r') ? text.replaceAll('\r\n', '\n').replaceAll('\r', '\n') : text;
  const parts = unified.split('\n');
  if (parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

/**
 * `pyStrip` of `s[start .. end)` as a range: the bounds moved past the
 * Python_Whitespace at either end (every member is one code unit).
 */
function pyStripRange(s: string, start: number, end: number): [number, number] {
  while (start < end && PY_WHITESPACE.has(s[start] as string)) {
    start++;
  }
  while (end > start && PY_WHITESPACE.has(s[end - 1] as string)) {
    end--;
  }
  return [start, end];
}

/**
 * Parse the feature tokens of an affix or stem line (upstream's
 * `_parse_analysis_line_toks` over `feats.split(' ')`): skip empty tokens,
 * split each on the first `:`, and keep the first colon-part as the key with
 * the remainder (rejoined on `:`) as the value. A token with no `:` (fewer
 * than 2 colon-parts) is a parse error. Each token goes to `table` as a
 * Feature_Id and a value string id, in token order; the table keeps a
 * repeated key at its first position with its last value, as the dictionary
 * did. A value whose key is `lexKey` is stored stripped (`stripLex`).
 *
 * The tokens are the pieces of `feats[start .. n)` between single spaces, as
 * `pySplitOn` of that range yields them, read in place. Upstream splits each on every `:` and rejoins
 * the tail; cutting at the first `:` gives the same key and value without
 * building the parts. No token is sliced: a value is interned straight from
 * its range of `feats` (only a `lex` value is cut out, for `stripLex`).
 *
 * `cache` holds, per position, the previous line's token as its key, the text
 * of its value (a copy) and their ids. Over the Database_Pin 68% of feature
 * tokens equal it, which two `startsWith` tests confirm, and most others
 * share its key; either way it gives the ids interning would.
 */
function parseAnalysisLineToks(
  feats: string,
  start: number,
  n: number,
  model: ModelBuilder,
  table: EntryTableBuilder,
  cache: TokenCache,
  lexKey?: string,
): void {
  const strings = model.strings;

  // The features are `feats[start .. n)`. `o` is where token `j` starts; the
  // pieces between single spaces include the empty ones, which are skipped.
  for (let o = start, j = 0; o <= n; j++) {
    const key = cache.key[j];
    if (
      key !== undefined &&
      o + key.length < n &&
      feats.charCodeAt(o + key.length) === 0x3a &&
      feats.startsWith(key, o)
    ) {
      // The previous token's key, followed by a `:` (a key holds no `:`, so
      // that `:` is the token's first). The whole token repeats when the
      // value text follows and the token ends there.
      const colon = o + key.length;
      const text = cache.text[j] as string;
      const valueEnd = colon + 1 + text.length;
      if (
        valueEnd <= n &&
        (valueEnd === n || feats.charCodeAt(valueEnd) === 0x20) &&
        feats.startsWith(text, colon + 1)
      ) {
        table.token(cache.feature[j] as number, cache.value[j] as number);
        o = valueEnd + 1;
        continue;
      }
      let end = feats.indexOf(' ', colon);
      if (end === -1 || end > n) {
        end = n;
      }
      readValue(feats, colon, end, cache.feature[j] as number, key, j, strings, table, cache, lexKey);
      o = end + 1;
      continue;
    }

    let end = feats.indexOf(' ', o);
    if (end === -1 || end > n) {
      end = n;
    }
    if (end === o) {
      o++;
      continue;
    }
    const colon = feats.indexOf(':', o);
    if (colon === -1 || colon >= end) {
      throw new DatabaseParseError(`invalid key value pair ${pyRepr(feats.slice(o, end))}`);
    }
    const feature = model.featureId(feats.slice(o, colon));
    readValue(feats, colon, end, feature, model.schema.names[feature] as string, j, strings, table, cache, lexKey);
    o = end + 1;
  }
}

/**
 * The value of a token whose key `key` (Feature_Id `feature`) ends at the
 * `:` at `colon` and whose value ends at `end`: interned from its range
 * (stripped first when the key is `lexKey`), handed to `table`, and kept in
 * `cache` at position `j`.
 */
function readValue(
  feats: string,
  colon: number,
  end: number,
  feature: number,
  key: string,
  j: number,
  strings: ModelBuilder['strings'],
  table: EntryTableBuilder,
  cache: TokenCache,
  lexKey: string | undefined,
): void {
  let value: number;
  let text: string;
  if (key === lexKey) {
    const raw = feats.slice(colon + 1, end);
    value = strings.intern(stripLex(raw));
    text = freshCopy(raw);
  } else {
    value = strings.internRange(feats, colon + 1, end);
    text = strings.string(value);
  }
  cache.key[j] = key;
  cache.feature[j] = feature;
  cache.text[j] = text;
  cache.value[j] = value;
  table.token(feature, value);
}

/**
 * The previous line's category (with its role id) and surface, for the entry
 * sections: consecutive lines usually share a category, and consecutive stems
 * often share a surface, so a `startsWith` test replaces the interning then.
 */
class LineCache {
  category: string | undefined;
  categoryRole = -1;
  surface: string | undefined;

  /** The role id of `line[start .. end)`, through `roleOf` when it is not the previous line's. */
  role(
    line: string,
    start: number,
    end: number,
    strings: ModelBuilder['strings'],
    roleOf: (name: string) => number,
  ): number {
    const last = this.category;
    if (last === undefined || last.length !== end - start || !line.startsWith(last, start)) {
      this.category = strings.string(strings.internRange(line, start, end));
      this.categoryRole = roleOf(this.category);
    }
    return this.categoryRole;
  }

  /** The table's copy of the surface `line[start .. end)`. */
  surfaceOf(line: string, start: number, end: number, strings: ModelBuilder['strings']): string {
    let surface = this.surface;
    if (surface === undefined || surface.length !== end - start || !line.startsWith(surface, start)) {
      surface = strings.string(strings.internRange(line, start, end));
      this.surface = surface;
    }
    return surface;
  }
}

/** The previous line's tokens by position, for {@link parseAnalysisLineToks}. */
class TokenCache {
  readonly key: string[] = [];
  readonly feature: number[] = [];
  /** The value's text as the line states it (a copy; raw, for `lex`). */
  readonly text: string[] = [];
  readonly value: number[] = [];
}

/**
 * Parse the feature tokens of a DEFAULTS line (upstream's
 * `_parse_defaults_line_toks`): split each on the first `:`, keep the first
 * part as the key and the remainder (rejoined on `:`) as the value, with a
 * bare `*` value becoming `null`. A token with no `:` is a parse error. Unlike
 * the analysis parser, empty tokens are not skipped.
 */
function parseDefaultsLineToks(
  toks: string[],
): Record<string, string | null> {
  const res: Record<string, string | null> = {};

  for (const tok of toks) {
    const subtoks = pySplitOn(tok, ':');
    if (subtoks.length < 2) {
      throw new DatabaseParseError(
        `invalid key value pair ${pyRepr(tok)} in DEFAULTS`,
      );
    }

    const feat = subtoks[0] as string;
    const val = subtoks.slice(1).join(':');

    res[feat] = val === '*' ? null : val;
  }

  return res;
}
