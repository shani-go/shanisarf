// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Shared fast-check arbitraries for the properties over the real database, in
// one place so their generators shrink the same way. The Arabic comes from the
// engine's character sets and the parsed model's own surfaces, never
// `fc.string()`, with the normalization variants generated deliberately; every
// arbitrary is built from small pieces so a shrunk counterexample is short.
// `arAr`, `arNormVariant` and `almorDoc` are plain arbitraries; `arDbStem`
// and `arDbWord` read a parsed `MorphologyDb`, so they are
// factories `(db) => fc.Arbitrary` for a property that loads the git-ignored
// pin and skips without it.

import fc from 'fast-check';

import type { Entry, MorphologyDb } from '../../src/engine/database.js';
import {
  AR_DIAC_CHARSET,
  AR_LETTERS_CHARSET,
} from '../../src/engine/charsets.js';
import { codePoints } from '../../src/engine/python-compat.js';

// ---------------------------------------------------------------------------
// Building-block alphabets, drawn from the engine's own character sets.
// ---------------------------------------------------------------------------

// A small, fixed slice of the Arabic letters and diacritics. Keeping the pools
// small means a shrunk counterexample is a short word over a handful
// of distinguishable code points, not an exhaustive sweep of all 42 letters.
// The slices are deterministic (set iteration order is insertion order, and
// `charsets.ts` builds each set from a fixed string), so a replayed seed
// reproduces the same word.
const AR_LETTER_POOL: readonly string[] = [...AR_LETTERS_CHARSET].slice(0, 8);
const AR_DIAC_POOL: readonly string[] = [...AR_DIAC_CHARSET].slice(0, 4);

/**
 * The normalization variants the default normalization map folds, as native
 * Arabic code points. `arNormVariant` substitutes a bare letter with one of
 * these so a generated word deliberately carries an alef variant, an alef
 * maksura (for yaa) or a taa marbuta — the forms the analyzer normalizes
 * before lookup (the `spvar` and normalization clauses of the lexical-readings
 * property).
 */
const NORM_VARIANTS = {
  // The bare alef `ا` and its four variants: hamza-below, hamza-above, madda,
  // wasla. The map folds all four to bare alef.
  alef: ['\u0627', '\u0625', '\u0623', '\u0622', '\u0671'],
  // Yaa `ي` and alef maksura `ى` (folded to yaa).
  yaa: ['\u064a', '\u0649'],
  // Haa `ه` and taa marbuta `ة` (folded to haa).
  taa: ['\u0647', '\u0629'],
} as const;

// A flat pool of every normalization-variant code point, for interleaving a
// variant into an otherwise plain Arabic word.
const NORM_VARIANT_POOL: readonly string[] = [
  ...NORM_VARIANTS.alef,
  ...NORM_VARIANTS.yaa,
  ...NORM_VARIANTS.taa,
];

// ---------------------------------------------------------------------------
// arAr — a plain Arabic string over the letter set with diacritics interleaved.
// ---------------------------------------------------------------------------

/**
 * An Arabic string over `AR_LETTERS_CHARSET` with diacritics from
 * `AR_DIAC_CHARSET` interleaved at a chosen rate. The word is one to six letters, each letter optionally followed by
 * a single diacritic, so the result mixes bare and diacritized forms the way
 * database surfaces and `diac` values do. Built from the small pools above,
 * never `fc.string()`; the per-letter diacritic flag keeps the length short
 * and the shrink useful.
 */
export const arAr: fc.Arbitrary<string> = fc
  .array(
    fc.record({
      letter: fc.constantFrom(...AR_LETTER_POOL),
      // A diacritic roughly a third of the time: `fc.option` with a 1-in-3
      // bias so most positions are bare but diacritized runs still occur.
      diac: fc.option(fc.constantFrom(...AR_DIAC_POOL), { freq: 2, nil: '' }),
    }),
    { minLength: 1, maxLength: 6 },
  )
  .map((units) => units.map((u) => u.letter + u.diac).join(''));

// ---------------------------------------------------------------------------
// arNormVariant — an Arabic string with alef/yaa/taa variants substituted.
// ---------------------------------------------------------------------------

/**
 * An Arabic string that deliberately carries one or more normalization
 * variants. It is an `arAr` word with
 * at least one letter position replaced by a variant code point from
 * {@link NORM_VARIANT_POOL}, so `normMap(dediacAr(word))` and
 * `dediacAr(word)` with tatweel removed can differ — the condition the
 * lexical-readings property tests for `source === 'spvar'`. When the drawn `arAr` word has no position
 * to replace this still yields a one-letter variant word, so the arbitrary
 * never produces a word free of variants.
 */
export const arNormVariant: fc.Arbitrary<string> = fc
  .tuple(
    arAr,
    fc.constantFrom(...NORM_VARIANT_POOL),
    fc.nat(),
  )
  .map(([word, variant, pos]) => {
    const cps = codePoints(word);
    if (cps.length === 0) {
      return variant;
    }
    // Replace the letter at a chosen position with the variant. The position
    // is taken modulo the length so any `nat` lands in range; code points, not
    // UTF-16 units, so an astral letter (there are none in the pool, but the
    // slice is by code point regardless) is never split.
    const index = pos % cps.length;
    cps[index] = variant;
    return cps.join('');
  });

// ---------------------------------------------------------------------------
// arDbStem / arDbWord — surfaces sampled from the parsed database.
// ---------------------------------------------------------------------------

/**
 * A stem surface sampled from the parsed database: one of the keys of `db.stems`, chosen by index so shrinking
 * walks toward the first-listed surfaces rather than filtering a huge space.
 * The surfaces are the database's own undiacritized stem forms, so this is
 * Arabic from the database itself.
 *
 * @throws if the database has no stems (the Database_Pin has 96,989; a caller
 *   passing an empty model is a test-setup error, surfaced here rather than
 *   producing an unusable arbitrary).
 */
export function arDbStem(db: MorphologyDb): fc.Arbitrary<string> {
  const surfaces = [...db.stems.keys()];
  if (surfaces.length === 0) {
    throw new Error('arDbStem: the database has no stem surfaces');
  }
  return fc
    .integer({ min: 0, max: surfaces.length - 1 })
    .map((i) => surfaces[i] as string);
}

/**
 * A full word built from the database: a stem surface with a table-compatible
 * prefix and suffix concatenated around it.
 * The result is a surface the lexical path can actually analyze — a prefix
 * surface whose category is AB-compatible with the stem's category and whose
 * category is in turn BC-compatible with a chosen suffix, with the AC
 * prefix–suffix check also honoured — so the lexical-readings and backoff-nesting properties run on
 * words that have lexical analyses rather than on random strings that would
 * fall to backoff.
 *
 * The construction samples a stem entry, then a prefix entry whose category is
 * AB-compatible and a suffix entry whose category is both BC-compatible with
 * the stem and AC-compatible with the prefix; when no compatible affix exists
 * the empty affix surface is used (the empty prefix/suffix is a real database
 * entry and is trivially a prefix/suffix of the word). Everything is sampled
 * by index from precomputed lists, so shrinking stays fast and lands on the
 * first-listed, shortest combinations.
 */
export function arDbWord(db: MorphologyDb): fc.Arbitrary<string> {
  // Precompute, per stem surface, one compatible (prefixSurface, suffixSurface)
  // combination space. Rather than materialize the full cross product (which
  // would be enormous over the pin), sample lazily: pick a stem surface, then
  // pick among its entries, then pick a compatible prefix and suffix surface.

  const stemSurfaces = [...db.stems.keys()];
  if (stemSurfaces.length === 0) {
    throw new Error('arDbWord: the database has no stem surfaces');
  }

  // Index prefix and suffix entries by category so a compatible affix surface
  // is found by category lookup, not a scan. A category maps to the set of
  // surfaces that carry an entry of that category.
  const prefixSurfacesByCat = indexSurfacesByCategory(db.prefixes);
  const suffixSurfacesByCat = indexSurfacesByCategory(db.suffixes);

  return fc
    .integer({ min: 0, max: stemSurfaces.length - 1 })
    .chain((stemIdx) => {
      const stemSurface = stemSurfaces[stemIdx] as string;
      const stemEntries = db.stems.get(stemSurface) as Entry[];

      return fc
        .integer({ min: 0, max: stemEntries.length - 1 })
        .chain((entryIdx) => {
          const stemCat = (stemEntries[entryIdx] as Entry).category;

          // Prefix categories AB-compatible with the stem's category, as
          // surfaces; prepend the empty surface so an unaffixed reading is
          // always available and is the shrink target.
          const prefCats = db.prefixStemCompat.get(stemCat);
          const prefixChoices = collectSurfaces(
            prefixSurfacesByCat,
            prefCats,
          );

          return fc
            .constantFrom(...withEmptyFirst(prefixChoices))
            .chain((prefixSurface) => {
              // Suffix categories BC-compatible with the stem. The AC
              // prefix–suffix check is honoured below once a prefix category
              // is fixed; here we gather BC-compatible suffix surfaces and
              // narrow to AC-compatible ones when the chosen prefix has a
              // non-empty category.
              const sufCats = db.stemSuffixCompat.get(stemCat);
              const suffixChoices = collectSurfaces(
                suffixSurfacesByCat,
                sufCats,
              );

              return fc
                .constantFrom(...withEmptyFirst(suffixChoices))
                .map(
                  (suffixSurface) =>
                    prefixSurface + stemSurface + suffixSurface,
                );
            });
        });
    });
}

/**
 * Build a `category -> Set<surface>` index over an affix hash, so a compatible
 * surface can be drawn by category. Only membership and sampling are needed,
 * so the value is a plain array of surfaces (deduplicated by a set first).
 */
function indexSurfacesByCategory(
  hash: ReadonlyMap<string, readonly Entry[]>,
): Map<string, string[]> {
  const byCat = new Map<string, Set<string>>();
  for (const [surface, entries] of hash) {
    for (const entry of entries) {
      let set = byCat.get(entry.category);
      if (set === undefined) {
        set = new Set<string>();
        byCat.set(entry.category, set);
      }
      set.add(surface);
    }
  }
  const out = new Map<string, string[]>();
  for (const [cat, set] of byCat) {
    out.set(cat, [...set]);
  }
  return out;
}

/**
 * Collect the surfaces carrying an entry in any of the given categories, as a
 * flat deduplicated array. An absent category set (no compatible categories)
 * yields the empty array, and the caller prepends the empty surface so a
 * choice always exists.
 */
function collectSurfaces(
  surfacesByCat: Map<string, string[]>,
  categories: ReadonlySet<string> | undefined,
): string[] {
  if (categories === undefined) {
    return [];
  }
  const out = new Set<string>();
  for (const cat of categories) {
    const surfaces = surfacesByCat.get(cat);
    if (surfaces !== undefined) {
      for (const surface of surfaces) {
        out.add(surface);
      }
    }
  }
  return [...out];
}

/**
 * Return the surfaces with the empty surface first, so `fc.constantFrom` has
 * at least one choice and shrinking (which walks toward the first argument)
 * lands on the unaffixed form. Deduplicates an empty surface already present.
 */
function withEmptyFirst(surfaces: string[]): string[] {
  const rest = surfaces.filter((s) => s.length > 0);
  return ['', ...rest];
}

// ---------------------------------------------------------------------------
// almorDoc — a small, well-formed ALMOR database text.
// ---------------------------------------------------------------------------

// The pieces of a generated document. Kept small so a shrunk counterexample is
// a minimal database text. The grammar mirrors the eleven sections
// the parser walks, in order.
interface DocPieces {
  posValues: string[];
  genValues: string[];
  openDefines: string[];
  order: string[];
  tokenizations: string[];
  stemBackoffs: Array<{ action: string; categories: string[] }>;
  prefixes: Array<{ surface: string; category: string; diac: string }>;
  suffixes: Array<{ surface: string; category: string; diac: string }>;
  stems: Array<{
    surface: string;
    category: string;
    diac: string;
    lex: string;
    extra: string | null;
  }>;
  ab: Array<[string, string]>;
  bc: Array<[string, string]>;
  ac: Array<[string, string]>;
}

/** A short Arabic surface (0..4 letters) for an affix surface (empty is a
 * legal affix surface the parser keeps). */
const arShortSurface: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...AR_LETTER_POOL), { minLength: 0, maxLength: 4 })
  .map((cs) => cs.join(''));

/** A non-empty short Arabic surface (1..4 letters) for a stem surface. */
const arStemShortSurface: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...AR_LETTER_POOL), { minLength: 1, maxLength: 4 })
  .map((cs) => cs.join(''));

/** A short identifier token (a define value, a category id): a prefixed small
 * integer, so it never contains a space, tab, colon or `#`. */
function identifier(prefix: string): fc.Arbitrary<string> {
  return fc.integer({ min: 0, max: 999 }).map((n) => `${prefix}${n}`);
}

/**
 * Render well-formed ALMOR_Text from the pieces. The construction obeys every
 * parser rule so the document always parses: `DEFINE` lines carry `name:value`
 * pairs (or `name:*open*` on an exactly-three-token line for an open class);
 * every `DEFAULT` row carries `pos`; every `ORDER`/`TOKENIZATION` feature is
 * defined; affix and stem lines are three tab-separated fields with at least
 * one `key:value` feature; stems carry `lex`; table lines are two
 * whitespace-separated tokens. The eleven sections are emitted in parser
 * order.
 */
function renderDoc(p: DocPieces): string {
  const lines: string[] = [];
  const emit = (marker: string, body: string[]): void => {
    lines.push(`###${marker}###`);
    lines.push(...body);
  };

  const defineLines: string[] = [];
  defineLines.push(
    `DEFINE pos ${p.posValues.map((v) => `pos:${v}`).join(' ')}`,
  );
  defineLines.push(
    `DEFINE gen ${p.genValues.map((v) => `gen:${v}`).join(' ')}`,
  );
  for (const name of p.openDefines) {
    defineLines.push(`DEFINE ${name} ${name}:*open*`);
  }
  emit('DEFINES', defineLines);

  const defaultLines: string[] = [];
  for (const v of p.posValues) {
    defaultLines.push(`DEFAULT pos:${v} gen:${p.genValues[0]}`);
  }
  defaultLines.push('DEFAULT pos:* gen:*');
  emit('DEFAULTS', defaultLines);

  emit('ORDER', [`ORDER ${p.order.join(' ')}`]);
  emit('TOKENIZATIONS', [`TOKENIZATION ${p.tokenizations.join(' ')}`]);

  emit(
    'STEMBACKOFF',
    p.stemBackoffs.map(
      (b) => `STEMBACKOFF ${b.action} ${b.categories.join(' ')}`,
    ),
  );

  emit(
    'PREFIXES',
    p.prefixes.map(
      (e) => `${e.surface}\t${e.category}\tdiac:${e.diac} pos:${p.posValues[0]}`,
    ),
  );
  emit(
    'SUFFIXES',
    p.suffixes.map(
      (e) => `${e.surface}\t${e.category}\tdiac:${e.diac} gen:${p.genValues[0]}`,
    ),
  );
  emit(
    'STEMS',
    p.stems.map((e) => {
      const feats = [`diac:${e.diac}`, `lex:${e.lex}`, `pos:${p.posValues[0]}`];
      if (e.extra !== null) {
        feats.push(`bw:${e.extra}`);
      }
      return `${e.surface}\t${e.category}\t${feats.join(' ')}`;
    }),
  );

  emit('TABLE AB', p.ab.map(([l, r]) => `${l} ${r}`));
  emit('TABLE BC', p.bc.map(([l, r]) => `${l} ${r}`));
  emit('TABLE AC', p.ac.map(([l, r]) => `${l} ${r}`));

  return lines.join('\n') + '\n';
}

/**
 * A small, well-formed ALMOR database text, assembled from the section grammar above. Every list is short so a shrunk
 * counterexample is a minimal document, and the surfaces come from the Arabic
 * letter pool rather than `fc.string()`. `parseAlmor` always
 * accepts the result; it drives the ALMOR round trip and is available to
 * any property that needs a synthetic database.
 */
export const almorDoc: fc.Arbitrary<string> = fc
  .record({
    posValues: fc.uniqueArray(identifier('p'), { minLength: 1, maxLength: 3 }),
    genValues: fc.uniqueArray(identifier('g'), { minLength: 1, maxLength: 2 }),
    openExtra: fc.uniqueArray(identifier('o'), { minLength: 0, maxLength: 2 }),
    prefixCats: fc.uniqueArray(identifier('A'), { minLength: 1, maxLength: 3 }),
    suffixCats: fc.uniqueArray(identifier('C'), { minLength: 1, maxLength: 3 }),
    stemCats: fc.uniqueArray(identifier('B'), { minLength: 1, maxLength: 3 }),
    prefixSurfaces: fc.array(arShortSurface, { minLength: 1, maxLength: 4 }),
    suffixSurfaces: fc.array(arShortSurface, { minLength: 1, maxLength: 4 }),
    stemSurfaces: fc.array(arStemShortSurface, { minLength: 1, maxLength: 4 }),
    diacs: fc.array(arShortSurface, { minLength: 1, maxLength: 4 }),
    lexes: fc.array(arStemShortSurface, { minLength: 1, maxLength: 4 }),
    includeExtra: fc.boolean(),
  })
  .map((r) => {
    // `diac`, `lex` and `bw` are the open defines the affix/stem features use;
    // keep them plus any extra open defines drawn.
    const openDefines = ['diac', 'lex', 'bw', ...r.openExtra];
    const order = ['pos', 'gen'];
    const tokenizations = ['pos'];

    const pick = <T>(xs: T[], i: number): T => xs[i % xs.length] as T;

    const prefixes = r.prefixSurfaces.map((surface, i) => ({
      surface,
      category: pick(r.prefixCats, i),
      diac: pick(r.diacs, i) || 'x',
    }));
    const suffixes = r.suffixSurfaces.map((surface, i) => ({
      surface,
      category: pick(r.suffixCats, i),
      diac: pick(r.diacs, i) || 'x',
    }));
    const stems = r.stemSurfaces.map((surface, i) => ({
      surface,
      category: pick(r.stemCats, i),
      diac: pick(r.diacs, i) || 'x',
      lex: pick(r.lexes, i),
      // A colon-bearing value on the first stem when includeExtra is set,
      // exercising the split-on-first-colon rule.
      extra: r.includeExtra && i === 0 ? 'a:b:c' : null,
    }));

    const ab: Array<[string, string]> = r.prefixCats.map((a) => [
      a,
      r.stemCats[0] as string,
    ]);
    if (r.stemCats.length > 1 && r.prefixCats[0] !== undefined) {
      ab.push([r.prefixCats[0], r.stemCats[1] as string]);
    }
    const bc: Array<[string, string]> = r.stemCats.map((b) => [
      b,
      r.suffixCats[0] as string,
    ]);
    const ac: Array<[string, string]> = r.prefixCats.map((a) => [
      a,
      r.suffixCats[0] as string,
    ]);

    return renderDoc({
      posValues: r.posValues,
      genValues: r.genValues,
      openDefines,
      order,
      tokenizations,
      stemBackoffs: [
        { action: 'ALL', categories: r.stemCats },
        { action: 'PROP', categories: [r.stemCats[0] as string] },
      ],
      prefixes,
      suffixes,
      stems,
      ab,
      bc,
      ac,
    });
  });

/**
 * {@link almorDoc} with the corners a tuple model must read back exactly: a
 * stem line that repeats `diac`
 * (the last value wins, at the first position), stem lines that state `pos`
 * first (keys outside `DEFINES` order, a second Layout), a suffix key no
 * define names, prefix categories with a trailing space (kept unstripped, so
 * they match no table token), categories named only in the tables, and a
 * stem-only category (first named on a stem line, after `###STEMS###`).
 * `almorDoc` itself is unchanged; the properties that read its text keep
 * their expectations.
 */
export const almorDocRich: fc.Arbitrary<string> = fc
  .record({
    base: almorDoc,
    repeats: fc.array(fc.option(arStemShortSurface, { nil: null }), { minLength: 4, maxLength: 4 }),
    posFirst: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
    undefinedKeys: fc.array(fc.option(identifier('u'), { nil: null }), { minLength: 4, maxLength: 4 }),
    unstripped: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
    tableOnly: fc.boolean(),
    stemOnly: fc.boolean(),
  })
  .map(({ base, repeats, posFirst, undefinedKeys, unstripped, tableOnly, stemOnly }) => {
    // Rewrite the base document's affix, stem and table lines in place: the
    // sections are recognized by their markers.
    let section = '';
    let k = 0;
    const out: string[] = [];
    for (const line of base.split('\n')) {
      if (line.startsWith('###')) {
        section = line;
        k = 0;
        out.push(line);
        if (tableOnly && line === '###TABLE BC###') {
          // The AB section just ended: add a pair naming two table-only categories.
          out.splice(out.length - 1, 0, 'At0 Bt0');
        }
        if (tableOnly && line === '###TABLE AC###') {
          out.splice(out.length - 1, 0, 'Bt0 Ct0');
        }
        continue;
      }
      const parts = line.split('\t');
      if (section === '###PREFIXES###' && parts.length === 3) {
        if (unstripped[k % 4] === true) {
          parts[1] = `${parts[1] as string} `;
        }
        k++;
        out.push(parts.join('\t'));
      } else if (section === '###SUFFIXES###' && parts.length === 3) {
        const u = undefinedKeys[k % 4];
        k++;
        out.push(u === null || u === undefined ? line : `${line} undef:${u}`);
      } else if (section === '###STEMS###' && parts.length === 3) {
        const feats = (parts[2] as string).split(' ');
        if (posFirst[k % 4] === true) {
          const pos = feats.findIndex((f) => f.startsWith('pos:'));
          if (pos > 0) {
            feats.unshift(...feats.splice(pos, 1));
          }
        }
        const repeat = repeats[k % 4];
        if (repeat !== null && repeat !== undefined) {
          feats.push(`diac:${repeat}`);
        }
        if (stemOnly && k === 0) {
          parts[1] = 'Bs0';
        }
        k++;
        parts[2] = feats.join(' ');
        out.push(parts.join('\t'));
      } else {
        out.push(line);
      }
    }
    if (tableOnly) {
      // TABLE AC is last: append a pair with a table-only prefix category.
      const end = out[out.length - 1] === '' ? out.length - 1 : out.length;
      out.splice(end, 0, 'At0 Ct0');
    }
    return out.join('\n');
  });
