// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The ALMOR round trip: for any synthetic ALMOR document,
// `parseAlmor(serializeAlmor(parseAlmor(text)))` deep-equals `parseAlmor(text)`,
// comparing `defines` values as sets (only membership survives) and every other
// structure exactly. And `parseAlmor` of a text with one injected fault (a
// non-`DEFINE` line in DEFINES, a `DEFAULT` row without `pos`, an `ORDER`
// feature not defined, a two-field affix line that is not a marker, a stem line
// without `lex`, a three-token table line, an unknown flag) throws the matching
// section error. Documents are built from the engine's own character sets and
// small pieces, so a counterexample is a short synthetic document.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseAlmor } from './almor-parser.js';
import { serializeAlmor } from './almor-serializer.js';
import type { MorphologyDb } from './database.js';
import { DatabaseParseError, InvalidDatabaseFlagError } from './errors.js';
import { AR_LETTERS_CHARSET } from './charsets.js';

const NUM_RUNS = 100;
const TIMEOUT = { timeout: 30_000 };

// The eleven section markers in the order the parser walks them.
const SECTION_ORDER = [
  'DEFINES',
  'DEFAULTS',
  'ORDER',
  'TOKENIZATIONS',
  'STEMBACKOFF',
  'PREFIXES',
  'SUFFIXES',
  'STEMS',
  'TABLE AB',
  'TABLE BC',
  'TABLE AC',
] as const;

// ---------------------------------------------------------------------------
// Small building-block alphabets.
// ---------------------------------------------------------------------------

// Arabic letters from the engine's own charset, for stem/affix surfaces and
// diacritic feature values. Kept to a handful so documents stay small and
// shrinking yields a short counterexample.
const AR_LETTERS = [...AR_LETTERS_CHARSET].slice(0, 8);

/** A short Arabic surface: zero or more Arabic letters (empty is a valid
 * affix surface, which the parser keeps). */
const arSurface: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...AR_LETTERS), { minLength: 0, maxLength: 4 })
  .map((cs) => cs.join(''));

/** A non-empty Arabic surface, for stems (an empty stem surface is legal in
 * ALMOR but a non-empty one keeps the generated stem list meaningful). */
const arStemSurface: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...AR_LETTERS), { minLength: 1, maxLength: 4 })
  .map((cs) => cs.join(''));

/** An identifier token (a define name, a feature name, a category id): a
 * short run from a small alphabet that contains no space, tab, colon or `#`,
 * so it never collides with a separator or a section marker. */
function identifier(prefix: string): fc.Arbitrary<string> {
  return fc
    .integer({ min: 0, max: 999 })
    .map((n) => `${prefix}${n}`);
}

// ---------------------------------------------------------------------------
// A well-formed almorDoc, assembled from small pieces.
// ---------------------------------------------------------------------------

interface DocPieces {
  // Define names that are plain (closed-class, with a value list) and that are
  // open (`*open*`). `pos` is always a plain define so DEFAULTS can carry it.
  posValues: string[];
  genValues: string[];
  openDefines: string[];
  // The ORDER list: a subset of the plain define names (always includes pos).
  order: string[];
  // The tokenization list: a subset of the plain define names.
  tokenizations: string[];
  stemBackoffs: Array<{ action: string; categories: string[] }>;
  prefixCats: string[];
  suffixCats: string[];
  stemCats: string[];
  prefixes: Array<{ surface: string; category: string; diac: string }>;
  suffixes: Array<{ surface: string; category: string; diac: string }>;
  stems: Array<{
    surface: string;
    category: string;
    diac: string;
    lex: string;
    // An extra feature whose value carries a colon, to exercise the
    // split-on-first-colon rule in both parser and serializer.
    extra: string | null;
  }>;
  ab: Array<[string, string]>;
  bc: Array<[string, string]>;
  ac: Array<[string, string]>;
}

/**
 * Build a well-formed ALMOR document from the pieces. The construction obeys
 * every parser rule so the document always parses: DEFINE lines carry
 * `name:value` pairs (or `name:*open*` for an open class on an exactly
 * three-token line); every DEFAULT row carries `pos`; every ORDER and
 * TOKENIZATION feature is defined; affix and stem lines are three
 * tab-separated fields with at least one `key:value` feature; stems carry
 * `lex`; table lines are two whitespace-separated tokens.
 */
function renderDoc(p: DocPieces): string {
  const lines: string[] = [];
  const emit = (marker: string, body: string[]): void => {
    lines.push(`###${marker}###`);
    lines.push(...body);
  };

  // DEFINES: pos and gen are closed classes; the rest are open. `diac`, `lex`
  // and `bw` are open so the affix/stem features that use them are defined in
  // spirit (the parser does not check affix feature names against defines, but
  // keeping them present makes the document realistic).
  const defineLines: string[] = [];
  defineLines.push(`DEFINE pos ${p.posValues.map((v) => `pos:${v}`).join(' ')}`);
  defineLines.push(`DEFINE gen ${p.genValues.map((v) => `gen:${v}`).join(' ')}`);
  for (const name of p.openDefines) {
    defineLines.push(`DEFINE ${name} ${name}:*open*`);
  }
  emit('DEFINES', defineLines);

  // DEFAULTS: each row carries pos; a `*` value becomes null on parse. The
  // final row is the `pos:*` catch-all (key null).
  const defaultLines: string[] = [];
  for (const v of p.posValues) {
    defaultLines.push(`DEFAULT pos:${v} gen:${p.genValues[0]}`);
  }
  defaultLines.push('DEFAULT pos:* gen:*');
  emit('DEFAULTS', defaultLines);

  // ORDER: one line listing defined features (last line wins; one line here).
  emit('ORDER', [`ORDER ${p.order.join(' ')}`]);

  // TOKENIZATIONS: one line listing defined features (slice(1) added to set).
  emit('TOKENIZATIONS', [`TOKENIZATION ${p.tokenizations.join(' ')}`]);

  // STEMBACKOFF: one line per action.
  emit(
    'STEMBACKOFF',
    p.stemBackoffs.map((b) => `STEMBACKOFF ${b.action} ${b.categories.join(' ')}`),
  );

  // PREFIXES / SUFFIXES: surface \t category \t key:value …
  emit(
    'PREFIXES',
    p.prefixes.map((e) => `${e.surface}\t${e.category}\tdiac:${e.diac} pos:${p.posValues[0]}`),
  );
  emit(
    'SUFFIXES',
    p.suffixes.map((e) => `${e.surface}\t${e.category}\tdiac:${e.diac} gen:${p.genValues[0]}`),
  );

  // STEMS: surface \t category \t key:value …, always carrying lex, sometimes
  // an extra feature whose value contains a colon.
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

  // The three compatibility tables: two whitespace-separated tokens per line.
  emit('TABLE AB', p.ab.map(([l, r]) => `${l} ${r}`));
  emit('TABLE BC', p.bc.map(([l, r]) => `${l} ${r}`));
  emit('TABLE AC', p.ac.map(([l, r]) => `${l} ${r}`));

  return lines.join('\n') + '\n';
}

/**
 * The `almorDoc` arbitrary: a well-formed ALMOR document assembled from the
 * small pieces above. Every list is kept short so a shrunk counterexample is
 * a minimal document, and the surfaces come from the Arabic charset rather
 * than `fc.string()`.
 */
const almorDoc: fc.Arbitrary<string> = fc
  .record({
    posValues: fc.uniqueArray(identifier('p'), { minLength: 1, maxLength: 3 }),
    genValues: fc.uniqueArray(identifier('g'), { minLength: 1, maxLength: 2 }),
    openExtra: fc.uniqueArray(identifier('o'), { minLength: 0, maxLength: 2 }),
    prefixCats: fc.uniqueArray(identifier('A'), { minLength: 1, maxLength: 3 }),
    suffixCats: fc.uniqueArray(identifier('C'), { minLength: 1, maxLength: 3 }),
    stemCats: fc.uniqueArray(identifier('B'), { minLength: 1, maxLength: 3 }),
    prefixSurfaces: fc.array(arSurface, { minLength: 1, maxLength: 4 }),
    suffixSurfaces: fc.array(arSurface, { minLength: 1, maxLength: 4 }),
    stemSurfaces: fc.array(arStemSurface, { minLength: 1, maxLength: 4 }),
    diacs: fc.array(arSurface, { minLength: 1, maxLength: 4 }),
    lexes: fc.array(arStemSurface, { minLength: 1, maxLength: 4 }),
    includeExtra: fc.boolean(),
  })
  .map((r) => {
    // `diac`, `lex` and `bw` are the open defines the affix/stem features use;
    // keep them plus any extra open defines the generator drew.
    const openDefines = ['diac', 'lex', 'bw', ...r.openExtra];

    // ORDER and TOKENIZATIONS over defined feature names (pos and gen are the
    // only closed defines; the parser only requires toks[1] to be defined, so
    // listing the closed defines keeps every feature valid).
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
      // A colon-bearing value on the first stem when includeExtra is set.
      extra: r.includeExtra && i === 0 ? 'a:b:c' : null,
    }));

    // Compatibility tables: each left category paired with the first right
    // category of the appropriate kind, plus a second pair where available so
    // a left category can map to several rights.
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
      prefixCats: r.prefixCats,
      suffixCats: r.suffixCats,
      stemCats: r.stemCats,
      prefixes,
      suffixes,
      stems,
      ab,
      bc,
      ac,
    });
  });

/**
 * Assert two models equal under the round-trip rule: `defines` values
 * compared as sets (an open class stays `null` on both sides), every other
 * field compared exactly.
 */
function expectModelsEqual(a: MorphologyDb, b: MorphologyDb): void {
  expect([...a.defines.keys()]).toEqual([...b.defines.keys()]);
  for (const [name, aVals] of a.defines) {
    const bVals = b.defines.get(name);
    if (aVals === null || bVals === null) {
      expect(aVals).toBe(bVals);
    } else {
      expect(new Set(aVals)).toEqual(new Set(bVals));
    }
  }

  expect(a.flags).toEqual(b.flags);
  expect(a.defaults).toEqual(b.defaults);
  expect(a.order).toEqual(b.order);
  expect(a.tokenizations).toEqual(b.tokenizations);
  expect(a.computeFeats).toEqual(b.computeFeats);
  expect(a.stemBackoffs).toEqual(b.stemBackoffs);
  expect(a.prefixes).toEqual(b.prefixes);
  expect(a.suffixes).toEqual(b.suffixes);
  expect(a.stems).toEqual(b.stems);
  expect(a.prefixStemCompat).toEqual(b.prefixStemCompat);
  expect(a.stemSuffixCompat).toEqual(b.stemSuffixCompat);
  expect(a.prefixSuffixCompat).toEqual(b.prefixSuffixCompat);
  expect(a.maxPrefixSize).toBe(b.maxPrefixSize);
  expect(a.maxSuffixSize).toBe(b.maxSuffixSize);
}

describe('ALMOR round trip', () => {
  it('parseAlmor(serializeAlmor(parseAlmor(doc))) equals parseAlmor(doc): defines as sets, everything else exact', () => {
    fc.assert(
      fc.property(almorDoc, (doc) => {
        const once = parseAlmor(doc);
        const twice = parseAlmor(serializeAlmor(once));
        expectModelsEqual(once, twice);
      }),
      { numRuns: NUM_RUNS, ...TIMEOUT },
    );
  });
});

// ---------------------------------------------------------------------------
// The injected-fault cases. Each takes a
// well-formed document and corrupts exactly one line so the parser raises the
// section's error. The documents are hand-written minimal — one injected
// fault is not a property over random input but a fixed assertion of the
// error-raising rule.
// ---------------------------------------------------------------------------

/** The minimal well-formed sections, as a map, so each fault can replace one
 * section's lines and leave the rest valid. */
function baseSections(): Record<string, string[]> {
  return {
    DEFINES: [
      'DEFINE pos pos:noun pos:verb',
      'DEFINE lex lex:*open*',
      'DEFINE diac diac:*open*',
    ],
    DEFAULTS: ['DEFAULT pos:noun', 'DEFAULT pos:*'],
    ORDER: ['ORDER pos'],
    TOKENIZATIONS: ['TOKENIZATION pos'],
    STEMBACKOFF: ['STEMBACKOFF ALL B0'],
    PREFIXES: ['wa\tA0\tdiac:wa pos:noun'],
    SUFFIXES: ['hu\tC0\tdiac:hu pos:noun'],
    STEMS: ['ktb\tB0\tdiac:katab lex:katab_1 pos:noun'],
    'TABLE AB': ['A0 B0'],
    'TABLE BC': ['B0 C0'],
    'TABLE AC': ['A0 C0'],
  };
}

/** Render a section map into a full document in parser order. */
function render(sections: Record<string, string[]>): string {
  const lines: string[] = [];
  for (const name of SECTION_ORDER) {
    lines.push(`###${name}###`);
    lines.push(...(sections[name] as string[]));
  }
  return lines.join('\n') + '\n';
}

/** A well-formed document with one section's lines replaced. */
function withSection(name: string, body: string[]): string {
  const sections = baseSections();
  sections[name] = body;
  return render(sections);
}

describe('injected-fault cases raise the section error', () => {
  it('a non-DEFINE line in DEFINES throws DatabaseParseError', () => {
    // "NOTADEFINE …" has three tokens but toks[0] !== 'DEFINE'.
    const doc = withSection('DEFINES', [
      'NOTADEFINE pos pos:noun',
      'DEFINE lex lex:*open*',
      'DEFINE diac diac:*open*',
    ]);
    expect(() => parseAlmor(doc)).toThrow(DatabaseParseError);
    expect(() => parseAlmor(doc)).toThrow(/DEFINES/);
  });

  it('a DEFAULTS row without pos throws DatabaseParseError', () => {
    // A valid DEFAULT shape but no pos feature: keyed on pos, so it is an
    // error.
    const doc = withSection('DEFAULTS', ['DEFAULT gen:m', 'DEFAULT pos:*']);
    expect(() => parseAlmor(doc)).toThrow(DatabaseParseError);
    expect(() => parseAlmor(doc)).toThrow(/missing pos/);
  });

  it('an ORDER feature not defined throws DatabaseParseError', () => {
    // 'undef' is not a DEFINE name, so ORDER rejects it.
    const doc = withSection('ORDER', ['ORDER undef']);
    expect(() => parseAlmor(doc)).toThrow(DatabaseParseError);
    expect(() => parseAlmor(doc)).toThrow(/ORDER/);
  });

  it('a PREFIXES line with the wrong tab count throws DatabaseParseError', () => {
    // Two tab-separated fields (not three) and not a section marker.
    const doc = withSection('PREFIXES', ['wa\tA0']);
    expect(() => parseAlmor(doc)).toThrow(DatabaseParseError);
    expect(() => parseAlmor(doc)).toThrow(/PREFIXES/);
  });

  it('a STEMS line without lex throws DatabaseParseError', () => {
    // Three tab fields and a valid key:value feature, but no `lex` feature.
    const doc = withSection('STEMS', ['ktb\tB0\tdiac:katab pos:noun']);
    expect(() => parseAlmor(doc)).toThrow(DatabaseParseError);
    expect(() => parseAlmor(doc)).toThrow(/STEMS/);
  });

  it('a TABLE line that is not two tokens throws DatabaseParseError', () => {
    // Three whitespace-separated tokens in TABLE AB.
    const doc = withSection('TABLE AB', ['A0 B0 extra']);
    expect(() => parseAlmor(doc)).toThrow(DatabaseParseError);
    expect(() => parseAlmor(doc)).toThrow(/TABLE AB/);
  });

  it('an unsupported database flag throws InvalidDatabaseFlagError', () => {
    // 'a', 'g' and 'r' are the flag characters; any other is refused.
    const doc = render(baseSections());
    expect(() => parseAlmor(doc, { flags: 'x' })).toThrow(
      InvalidDatabaseFlagError,
    );
  });
});
