// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the analyzer: the digit, punc and foreign classifications,
// empty input and stripping (against CAMeL Tools' special-path blocks), the
// lexical and backoff paths over tiny synthetic databases, and the API: options,
// cache and batch. Test words are invented, or digits and punctuation, never
// running text.
import { describe, expect, it } from 'vitest';

import { type Analysis, Analyzer, DEFAULT_NORMALIZE_MAP } from './analyzer.js';
import { CharMapper } from './charmap.js';
import { MorphologyDb, type DatabaseFlags, type Entry } from './database.js';
import { AnalyzerError } from './errors.js';
import type { LfuCache } from './lfu-cache.js';

/** Analysis-mode flags, the only mode in range for this spec. */
const ANALYSIS_FLAGS: DatabaseFlags = {
  analysis: true,
  generation: false,
  reinflection: false,
};

/**
 * The feature names the special paths touch, enough to exercise COPY_FEATS,
 * UNDEFINED_LEX_FEATS, catib6/ud and the log-probabilities. Values are
 * irrelevant (only membership is read), so each maps to a one-element list.
 */
const DEFINES = new Map<string, string[] | null>(
  [
    'gloss',
    'atbtok',
    'atbseg',
    'd1tok',
    'd1seg',
    'd2tok',
    'd2seg',
    'd3tok',
    'd3seg',
    'bwtok',
    'root',
    'pattern',
    'caphi',
    'catib6',
    'ud',
    'pos',
    'gen',
    'num',
    'pos_logprob',
    'lex_logprob',
    'pos_lex_logprob',
  ].map((f) => [f, ['x']] as [string, string[]]),
);

/**
 * The Map-shaped init these tests build models from (the adapter). A model is
 * read-only once built, so a test that
 * needs a variant edits the init through a builder's `edit` callback before
 * the model is constructed.
 */
interface TestInit {
  flags: DatabaseFlags;
  defines: Map<string, string[] | null>;
  defaults: Map<string | null, Record<string, string | null>>;
  order: string[] | null;
  tokenizations: Set<string>;
  computeFeats: Set<string>;
  stemBackoffs: Map<string, string[]>;
  prefixes: Map<string, Entry[]>;
  suffixes: Map<string, Entry[]>;
  stems: Map<string, Entry[]>;
  prefixStemCompat: Map<string, Set<string>>;
  stemSuffixCompat: Map<string, Set<string>>;
  prefixSuffixCompat: Map<string, Set<string>>;
  maxPrefixSize: number;
  maxSuffixSize: number;
}

/** Build a model from `init` after `edit`, if given, has changed it. */
function build(init: TestInit, edit?: (init: TestInit) => void): MorphologyDb {
  edit?.(init);
  return new MorphologyDb(init);
}

/**
 * Build a minimal analysis database carrying the digit, punc and latin default
 * rows. Each row gives `pos`, `gen` and `num` so the shallow copy has
 * something to carry; the empty affix/compat tables are enough because the
 * special paths never segment.
 */
function makeDb(
  options?: { omit?: 'digit' | 'punc' | 'latin' },
  edit?: (init: TestInit) => void,
): MorphologyDb {
  const defaults = new Map<string | null, Record<string, string | null>>();
  const row = (pos: string): Record<string, string | null> => ({
    pos,
    gen: 'm',
    num: 's',
  });
  if (options?.omit !== 'digit') defaults.set('digit', row('digit'));
  if (options?.omit !== 'punc') defaults.set('punc', row('punc'));
  if (options?.omit !== 'latin') defaults.set('latin', row('noun'));

  return build(
    {
      flags: ANALYSIS_FLAGS,
      defines: new Map(DEFINES),
      defaults,
      order: null,
      tokenizations: new Set(),
      computeFeats: new Set(),
      stemBackoffs: new Map(),
      prefixes: new Map(),
      suffixes: new Map(),
      stems: new Map(),
      prefixStemCompat: new Map(),
      stemSuffixCompat: new Map(),
      prefixSuffixCompat: new Map(),
      maxPrefixSize: 0,
      maxSuffixSize: 0,
    },
    edit,
  );
}

describe('Analyzer special paths', () => {
  it('returns [] for empty and whitespace-only input', () => {
    const a = new Analyzer(makeDb());
    expect(a.analyze('')).toEqual([]);
    // pyStrip removes Python_Whitespace; an all-whitespace word strips to ''.
    expect(a.analyze('   ')).toEqual([]);
  });

  it('classifies a digit word on the digit path', () => {
    const a = new Analyzer(makeDb());
    const result = a.analyze('123');
    expect(result).toHaveLength(1);
    const an = result[0]!;
    expect(an['diac']).toBe('123');
    expect(an['stem']).toBe('123');
    expect(an['stemgloss']).toBe('123');
    expect(an['stemcat']).toBeNull();
    expect(an['lex']).toBe('123');
    expect(an['bw']).toBe('123/NOUN_NUM');
    expect(an['source']).toBe('digit');
    // COPY_FEATS set to the word.
    expect(an['gloss']).toBe('123');
    expect(an['d3seg']).toBe('123');
    // UNDEFINED_LEX_FEATS set to the marker.
    expect(an['root']).toBe('DIGIT');
    expect(an['pattern']).toBe('DIGIT');
    expect(an['caphi']).toBe('DIGIT');
    expect(an['catib6']).toBe('NOM');
    expect(an['ud']).toBe('NUM');
    expect(an['pos_logprob']).toBe(-99);
    expect(an['lex_logprob']).toBe(-99);
    expect(an['pos_lex_logprob']).toBe(-99);
  });

  it('treats a word containing a digit as a number without strictDigit', () => {
    const a = new Analyzer(makeDb());
    // IS_DIGIT matches any word with a digit; the Latin letters do not route
    // it to foreign because digit is checked first.
    expect(a.analyze('a1b')[0]!['source']).toBe('digit');
  });

  it('requires an all-digit word under strictDigit', () => {
    const strict = new Analyzer(makeDb(), { strictDigit: true });
    // 'a1b' is not all digits, so it is not a number; it has no punctuation
    // and is not Arabic, so it takes the foreign path.
    expect(strict.analyze('a1b')[0]!['source']).toBe('foreign');
    // Arabic-Indic digits are digits under strict mode too.
    expect(strict.analyze('\u0661\u0662')[0]!['source']).toBe('digit');
  });

  it('classifies punctuation on the punc path', () => {
    const a = new Analyzer(makeDb());
    const an = a.analyze('!!')[0]!;
    expect(an['bw']).toBe('!!/PUNC');
    expect(an['source']).toBe('punc');
    expect(an['root']).toBe('PUNC');
    expect(an['catib6']).toBe('PNX');
    expect(an['ud']).toBe('PUNCT');
    expect(an['stemcat']).toBeNull();
  });

  it('classifies a non-Arabic word on the foreign path', () => {
    const a = new Analyzer(makeDb());
    const an = a.analyze('hello')[0]!;
    expect(an['pos']).toBe('foreign');
    expect(an['bw']).toBe('hello/FOREIGN');
    expect(an['source']).toBe('foreign');
    expect(an['root']).toBe('FOREIGN');
    expect(an['catib6']).toBe('FOREIGN');
    expect(an['ud']).toBe('X');
    expect(an['stemcat']).toBeNull();
  });

  it('does not mutate the database default row (shallow copy)', () => {
    const db = makeDb();
    const before = { ...db.defaults.get('digit')! };
    new Analyzer(db).analyze('5');
    expect(db.defaults.get('digit')).toEqual(before);
  });

  it('throws AnalyzerError naming the row when a default is absent', () => {
    const a = new Analyzer(makeDb({ omit: 'digit' }));
    expect(() => a.analyze('7')).toThrow(AnalyzerError);
    expect(() => a.analyze('7')).toThrow(/digit/);
  });

  it('exposes DEFAULT_NORMALIZE_MAP mapping the alef and tatweel variants', () => {
    // أ (hamza-above) → ا, ة → ه, tatweel removed.
    expect(DEFAULT_NORMALIZE_MAP.mapString('\u0623\u0629\u0640')).toBe(
      '\u0627\u0647',
    );
  });
});

// ---------------------------------------------------------------------------
// Lexical combination path. A tiny synthetic analysis database with one
// prefix, one stem and one suffix surface, wired through the AB/BC/AC tables,
// is enough to prove the segmentation, the compatibility product, the merge,
// the stem/stemcat assignment and the spvar rule. Test words are invented
// Arabic surfaces, never running text.
// ---------------------------------------------------------------------------

// The feature names a lexical analysis touches here: enough for the merge's
// JOIN/CONCAT steps and the pattern computation to run without reaching for
// features the db does not define.
const LEX_DEFINES = new Map<string, string[] | null>(
  ['diac', 'lex', 'bw', 'gloss', 'pos', 'root', 'pattern', 'caphi'].map(
    (f) => [f, ['x']] as [string, string[]],
  ),
);

/**
 * Build an analysis database with a single affixable surface. The prefix `ب`
 * (category `PRE`), the stem `كتب` (category `STEM`, lex `كَتَب`) and the empty
 * suffix (category `SUF`) are mutually compatible through AB/BC/AC, so the
 * surface `بكتب` has exactly one lexical analysis. `maxPrefixSize` 1 and
 * `maxSuffixSize` 0 keep the segmentation small and deterministic.
 */
function makeLexDb(edit?: (init: TestInit) => void): MorphologyDb {
  const prefixes = new Map<string, Entry[]>([
    ['\u0628', [{ category: 'PRE', features: { diac: '\u0628', bw: '\u0628/PREP', gloss: 'with' } }]],
  ]);
  // The empty suffix surface, category SUF, no features of its own.
  const suffixes = new Map<string, Entry[]>([
    ['', [{ category: 'SUF', features: { diac: '', bw: '', gloss: '' } }]],
  ]);
  // The stem surface كتب → the diacritized كَتَب, pos verb.
  const stems = new Map<string, Entry[]>([
    [
      '\u0643\u062a\u0628',
      [
        {
          category: 'STEM',
          features: {
            diac: '\u0643\u064e\u062a\u064e\u0628',
            lex: '\u0643\u064e\u062a\u064e\u0628',
            bw: '\u0643\u062a\u0628/VERB',
            gloss: 'write',
            pos: 'verb',
          },
        },
      ],
    ],
  ]);

  return build(
    {
      flags: ANALYSIS_FLAGS,
      defines: new Map(LEX_DEFINES),
      defaults: new Map(),
      order: null,
      tokenizations: new Set(),
      computeFeats: new Set(['pattern']),
      stemBackoffs: new Map(),
      prefixes,
      suffixes,
      stems,
      prefixStemCompat: new Map([['PRE', new Set(['STEM'])]]),
      stemSuffixCompat: new Map([['STEM', new Set(['SUF'])]]),
      prefixSuffixCompat: new Map([['PRE', new Set(['SUF'])]]),
      maxPrefixSize: 1,
      maxSuffixSize: 0,
    },
    edit,
  );
}

describe('Analyzer lexical path', () => {
  it('produces a lexical analysis for an affixable surface', () => {
    const a = new Analyzer(makeLexDb(), { normMap: null });
    // بكتب = prefix ب + stem كتب + empty suffix.
    const result = a.analyze('\u0628\u0643\u062a\u0628');
    expect(result).toHaveLength(1);
    const an = result[0]!;
    // The stem surface and category come from the stem entry.
    expect(an['stem']).toBe('\u0643\u064e\u062a\u064e\u0628');
    expect(an['stemcat']).toBe('STEM');
    // The merged diac prepends the prefix diac to the stem diac (CONCAT_FEATS).
    expect(an['diac']).toBe('\u0628\u0643\u064e\u062a\u064e\u0628');
    // JOIN_FEATS: bw joins prefix and stem bw with '+'.
    expect(an['bw']).toBe('\u0628/PREP+\u0643\u062a\u0628/VERB');
    // The pos is the stem's (step (b) leaves it when prefix/suffix are empty).
    expect(an['pos']).toBe('verb');
  });

  it('skips a triple whose stem category is not AB-compatible with the prefix', () => {
    // Break AB: the prefix category admits no stem category.
    const db = makeLexDb((init) => init.prefixStemCompat.set('PRE', new Set()));
    const a = new Analyzer(db, { normMap: null });
    expect(a.analyze('\u0628\u0643\u062a\u0628')).toEqual([]);
  });

  it('treats an absent prefix category in AB as an empty set, not an error', () => {
    // Remove the prefix category's AB row entirely; upstream would KeyError,
    // the port skips the pair and returns no lexical analysis.
    const db = makeLexDb((init) => init.prefixStemCompat.delete('PRE'));
    const a = new Analyzer(db, { normMap: null });
    expect(a.analyze('\u0628\u0643\u062a\u0628')).toEqual([]);
  });

  it('marks a spelling variant with source spvar when the dediac differs', () => {
    // Make the stem diac carry an extra alef so dediac(merged.diac) no longer
    // equals the dediac of the input word: the surface is a spelling variant.
    const db = makeLexDb((init) => {
      const stemEntry = init.stems.get('\u0643\u062a\u0628')![0]!;
      init.stems.set('\u0643\u062a\u0628', [
        { ...stemEntry, features: { ...stemEntry.features, diac: '\u0643\u0627\u062a\u0628' } }, // كاتب (extra alef)
      ]);
    });
    const a = new Analyzer(db, { normMap: null });
    const an = a.analyze('\u0628\u0643\u062a\u0628')[0]!;
    expect(an['source']).toBe('spvar');
  });

  it('does not set spvar when the dediac matches the input', () => {
    const a = new Analyzer(makeLexDb(), { normMap: null });
    const an = a.analyze('\u0628\u0643\u062a\u0628')[0]!;
    // dediac(بكَتَب) === بكتب === the input, so no spvar.
    expect(an['source']).not.toBe('spvar');
  });
});

// ---------------------------------------------------------------------------
// Backoff path. A tiny synthetic analysis
// database with a `NOAN` stem surface and a STEMBACKOFF mapping for the ALL
// and PROP actions is enough to prove: that backoff produces a `backoff`-source
// analysis for a non-word, that the stem segment is substituted for `NOAN` in
// bw/diac/lex, and that PROP filters a stem whose bw lacks NOUN_PROP. Test
// words are invented Arabic surfaces, never running text.
// ---------------------------------------------------------------------------

// The feature names a backoff analysis touches: diac/lex/bw carry NOAN and are
// substituted; gloss/caphi/pattern are set; pos lets the merge run.
const BACKOFF_DEFINES = new Map<string, string[] | null>(
  ['diac', 'lex', 'bw', 'gloss', 'caphi', 'pos', 'root', 'pattern'].map(
    (f) => [f, ['x']] as [string, string[]],
  ),
);

/**
 * Build an analysis database whose only stems are two `NOAN` backoff stems:
 * one proper noun (bw carries `NOUN_PROP`, category `PROP_CAT`) and one plain
 * noun (bw `NOAN/NOUN`, category `NOUN_CAT`). The empty prefix and empty
 * suffix are mutually compatible with both stem categories through AB/BC/AC,
 * so any Arabic non-word segments as empty-prefix + whole-stem + empty-suffix
 * and both backoff stems apply. `stemBackoffs` maps `ALL` to both categories
 * and `PROP` to the proper-noun category only.
 */
function makeBackoffDb(edit?: (init: TestInit) => void): MorphologyDb {
  const prefixes = new Map<string, Entry[]>([
    ['', [{ category: 'PRE', features: { diac: '', bw: '', gloss: '' } }]],
  ]);
  const suffixes = new Map<string, Entry[]>([
    ['', [{ category: 'SUF', features: { diac: '', bw: '', gloss: '' } }]],
  ]);
  // The NOAN stems: diac/lex/bw carry the NOAN marker to be substituted.
  const stems = new Map<string, Entry[]>([
    [
      'NOAN',
      [
        {
          category: 'NOUN_CAT',
          features: {
            diac: 'NOAN',
            lex: 'NOAN',
            bw: 'NOAN/NOUN',
            gloss: 'noun-gloss',
            pos: 'noun',
          },
        },
        {
          category: 'PROP_CAT',
          features: {
            diac: 'NOAN',
            lex: 'NOAN',
            bw: 'NOAN/NOUN_PROP',
            gloss: 'prop-gloss',
            pos: 'noun_prop',
          },
        },
      ],
    ],
  ]);

  return build({
    flags: ANALYSIS_FLAGS,
    defines: new Map(BACKOFF_DEFINES),
    defaults: new Map(),
    order: null,
    tokenizations: new Set(),
    computeFeats: new Set(['pattern']),
    stemBackoffs: new Map([
      ['ALL', ['NOUN_CAT', 'PROP_CAT']],
      ['PROP', ['PROP_CAT']],
    ]),
    prefixes,
    suffixes,
    stems,
    prefixStemCompat: new Map([
      ['PRE', new Set(['NOUN_CAT', 'PROP_CAT'])],
    ]),
    stemSuffixCompat: new Map([
      ['NOUN_CAT', new Set(['SUF'])],
      ['PROP_CAT', new Set(['SUF'])],
    ]),
    prefixSuffixCompat: new Map([['PRE', new Set(['SUF'])]]),
    maxPrefixSize: 0,
    maxSuffixSize: 0,
  }, edit);
}

describe('Analyzer backoff path', () => {
  it('produces backoff analyses for a non-word under NOAN_ALL and substitutes the stem', () => {
    const a = new Analyzer(makeBackoffDb(), {
      backoff: 'NOAN_ALL',
      normMap: null,
    });
    // سمكة is not in the (empty) lexical stem table, so no lexical analysis is
    // produced and the NOAN condition fires. Segmentation with max sizes 0
    // yields exactly empty-prefix + whole-word stem + empty-suffix.
    const word = '\u0633\u0645\u0643\u0629';
    const result = a.analyze(word);
    // Both NOAN stems (noun and proper noun) apply under ALL.
    expect(result).toHaveLength(2);
    for (const an of result) {
      // The backoff markers.
      expect(an['source']).toBe('backoff');
      expect(an['pattern']).toBe('backoff');
      // The NOAN segment was substituted into diac/lex/bw with the stem
      // surface (the whole word, since prefix/suffix are empty).
      expect(an['stem']).toBe(word);
      expect(an['lex']).toBe(word);
      expect(an['bw']).toContain(word);
      // No NOAN marker survives the substitution.
      expect(an['bw']).not.toContain('NOAN');
      expect(an['diac']).not.toContain('NOAN');
      expect(an['lex']).not.toContain('NOAN');
    }
    // The gloss is the copy's gloss, not the joined gloss.
    const glosses = result.map((an) => an['gloss']).sort();
    expect(glosses).toEqual(['noun-gloss', 'prop-gloss']);
  });

  it('filters a stem whose bw lacks NOUN_PROP under the PROP action', () => {
    const a = new Analyzer(makeBackoffDb(), {
      backoff: 'NOAN_PROP',
      normMap: null,
    });
    const word = '\u0633\u0645\u0643\u0629';
    const result = a.analyze(word);
    // Only the proper-noun stem (bw contains NOUN_PROP) survives.
    expect(result).toHaveLength(1);
    const an = result[0]!;
    expect(an['stemcat']).toBe('PROP_CAT');
    expect(an['source']).toBe('backoff');
    // The substituted bw keeps the NOUN_PROP tag with the stem substituted.
    expect(an['bw']).toBe(`${word}/NOUN_PROP`);
  });

  it('does not run backoff under NOAN when a lexical analysis exists', () => {
    // Add a real lexical stem for the word so the NOAN condition does not fire.
    const word = '\u0633\u0645\u0643\u0629';
    const db = makeBackoffDb((init) => init.stems.set(word, [
      {
        category: 'NOUN_CAT',
        features: {
          diac: word,
          lex: word,
          bw: `${word}/NOUN`,
          gloss: 'fish',
          pos: 'noun',
        },
      },
    ]));
    const a = new Analyzer(db, { backoff: 'NOAN_ALL', normMap: null });
    const result = a.analyze(word);
    // One lexical analysis, no backoff (source is not 'backoff').
    expect(result).toHaveLength(1);
    expect(result[0]!['source']).not.toBe('backoff');
  });

  it('runs ADD backoff even when a lexical analysis exists', () => {
    const word = '\u0633\u0645\u0643\u0629';
    const db = makeBackoffDb((init) => init.stems.set(word, [
      {
        category: 'NOUN_CAT',
        features: {
          diac: word,
          lex: word,
          bw: `${word}/NOUN`,
          gloss: 'fish',
          pos: 'noun',
        },
      },
    ]));
    const a = new Analyzer(db, { backoff: 'ADD_ALL', normMap: null });
    const result = a.analyze(word);
    // The lexical analysis plus the two backoff analyses, backoff appended
    // after the lexical one.
    expect(result).toHaveLength(3);
    expect(result[0]!['source']).not.toBe('backoff');
    expect(result[1]!['source']).toBe('backoff');
    expect(result[2]!['source']).toBe('backoff');
  });

  it('does not mutate the shared NOAN stem entry across pairs', () => {
    const db = makeBackoffDb();
    const before = db.stems.get('NOAN')!.map((e) => ({ ...e.features }));
    const a = new Analyzer(db, { backoff: 'NOAN_ALL', normMap: null });
    a.analyze('\u0633\u0645\u0643\u0629');
    const after = db.stems.get('NOAN')!.map((e) => e.features);
    // The model's shared entries still carry the un-substituted NOAN strings.
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).toEqual(before[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// API, options, cache and batch. The constructor validations, the normMap
// resolution, the LFU cache (transparency and keying by the stripped word),
// analyzeWords order and allFeats/tokFeats. Test words are invented Arabic
// surfaces, digits or punctuation, never running text.
// ---------------------------------------------------------------------------

describe('Analyzer constructor validations', () => {
  it('throws AnalyzerError when the database does not support analysis', () => {
    const db = makeDb(undefined, (init) => {
      init.flags = { analysis: false, generation: false, reinflection: false };
    });
    expect(() => new Analyzer(db)).toThrow(AnalyzerError);
    expect(() => new Analyzer(db)).toThrow(/does not support analysis/);
  });

  it('throws AnalyzerError on an invalid backoff mode', () => {
    expect(
      // A mode outside the five is rejected; cast past the type to exercise
      // the runtime guard a JavaScript caller could trip.
      () => new Analyzer(makeDb(), { backoff: 'BOGUS' as never }),
    ).toThrow(AnalyzerError);
    expect(
      () => new Analyzer(makeDb(), { backoff: 'BOGUS' as never }),
    ).toThrow(/Invalid backoff mode/);
  });

  it('accepts each of the five valid backoff modes', () => {
    for (const mode of [
      'NONE',
      'NOAN_ALL',
      'NOAN_PROP',
      'ADD_ALL',
      'ADD_PROP',
    ] as const) {
      expect(() => new Analyzer(makeDb(), { backoff: mode })).not.toThrow();
    }
  });

  it('throws AnalyzerError on a non-integer cache size', () => {
    expect(() => new Analyzer(makeDb(), { cacheSize: 1.5 })).toThrow(
      AnalyzerError,
    );
    expect(() => new Analyzer(makeDb(), { cacheSize: 1.5 })).toThrow(
      /Invalid cache size/,
    );
    // NaN and Infinity are not integers either.
    expect(() => new Analyzer(makeDb(), { cacheSize: NaN })).toThrow(
      AnalyzerError,
    );
    expect(() => new Analyzer(makeDb(), { cacheSize: Infinity })).toThrow(
      AnalyzerError,
    );
  });

  it('accepts an integer cache size, including 0', () => {
    expect(() => new Analyzer(makeDb(), { cacheSize: 0 })).not.toThrow();
    expect(() => new Analyzer(makeDb(), { cacheSize: 100 })).not.toThrow();
  });
});

describe('Analyzer normMap resolution', () => {
  // The stem surface is بكتب (prefix ب + stem كتب). A tatweel ـ (U+0640)
  // inserted into the input distinguishes the three resolutions: the default
  // map removes the tatweel (so بكـتب folds back to بكتب and matches), while
  // normalization-off leaves it in place (so بكـتب does not match). Note the
  // analyzer dediacritizes before normalizing, and the tatweel survives
  // dediacritization, so it reaches the normalization step.
  const WITH_TATWEEL = '\u0628\u0643\u0640\u062a\u0628'; // بكـتب
  const PLAIN = '\u0628\u0643\u062a\u0628'; // بكتب

  it('undefined normMap uses DEFAULT_NORMALIZE_MAP (folds the tatweel away)', () => {
    const a = new Analyzer(makeLexDb()); // normMap undefined → default map
    // The default map removes the tatweel, so بكـتب normalizes to بكتب and
    // matches the stem surface: one lexical analysis.
    expect(a.analyze(WITH_TATWEEL)).toHaveLength(1);
  });

  it('null normMap disables normalization (leaves the tatweel in place)', () => {
    const a = new Analyzer(makeLexDb(), { normMap: null });
    // With normalization off the tatweel stays, so بكـتب does not match the
    // بكتب stem surface: no lexical analysis. The plain surface still matches.
    expect(a.analyze(WITH_TATWEEL)).toEqual([]);
    expect(a.analyze(PLAIN)).toHaveLength(1);
  });

  it('a CharMapper normMap is used verbatim', () => {
    // A custom mapper that folds the hamza-above alef أ to the prefix ب, so a
    // word starting أكتب normalizes to بكتب and matches the stem surface.
    const custom = new CharMapper({ '\u0623': '\u0628' });
    const a = new Analyzer(makeLexDb(), { normMap: custom });
    // أكتب → (أ→ب) → بكتب, which segments as prefix ب + stem كتب.
    const result = a.analyze('\u0623\u0643\u062a\u0628');
    expect(result).toHaveLength(1);
    expect(result[0]!['stemcat']).toBe('STEM');
  });
});

/**
 * A database that carries both the lexical surface of `makeLexDb` and the
 * digit/punc/latin default rows of `makeDb`, so one analyzer can exercise
 * every classification path (digit, punc, foreign, lexical) in a single
 * sequence. Needed by the cache and batch tests, whose sequences mix paths.
 */
function makeFullDb(): MorphologyDb {
  return makeLexDb((init) => {
    // Widen the defines to the union of the lexical set and the special-path
    // set so both the merge (diac/lex/bw/…) and the special paths' COPY_FEATS/
    // UNDEFINED_LEX_FEATS/catib6/ud/log-prob assignments have features to land
    // on.
    for (const [k, v] of DEFINES) init.defines.set(k, v);
    // Add the three default rows the special paths copy.
    const row = (pos: string): Record<string, string | null> => ({
      pos,
      gen: 'm',
      num: 's',
    });
    init.defaults = new Map<string | null, Record<string, string | null>>([
      ['digit', row('digit')],
      ['punc', row('punc')],
      ['latin', row('noun')],
    ]);
  });
}

describe('Analyzer cache', () => {
  // A repeated-word sequence exercises hits; the digit/punc/foreign/lexical mix
  // exercises every path through the cache.
  const SEQUENCE = [
    '123',
    '!!',
    'hello',
    '\u0628\u0643\u062a\u0628',
    '123',
    '\u0628\u0643\u062a\u0628',
    '  123  ', // same stripped key as '123', so a hit
    '!!',
  ];

  it('cacheSize > 0 gives results identical to cacheSize 0 over a repeated sequence', () => {
    const uncached = new Analyzer(makeFullDb(), { normMap: null, cacheSize: 0 });
    for (const size of [1, 3, 100]) {
      const cached = new Analyzer(makeFullDb(), {
        normMap: null,
        cacheSize: size,
      });
      for (const word of SEQUENCE) {
        expect(cached.analyze(word)).toEqual(uncached.analyze(word));
      }
    }
  });

  it('a miss and a later hit both return the array the cache holds', () => {
    const a = new Analyzer(makeLexDb(), { normMap: null, cacheSize: 10 });
    const cache = a['cache'] as LfuCache<Analysis[]>;
    const word = '\u0628\u0643\u062a\u0628';
    const miss = a.analyze(word);
    expect(cache.get(word)).toBe(miss);
    const hit = a.analyze(` ${word} `);
    expect(hit).toBe(miss);
    expect(cache.get(word)).toBe(hit);
  });

  it('returns the same array object on a cache hit (read-only contract)', () => {
    const a = new Analyzer(makeLexDb(), { normMap: null, cacheSize: 10 });
    const first = a.analyze('\u0628\u0643\u062a\u0628');
    const second = a.analyze('\u0628\u0643\u062a\u0628');
    // The cached array itself is handed back on a hit.
    expect(second).toBe(first);
  });

  it('keys the cache by the stripped word', () => {
    // Inputs that differ only by surrounding Python_Whitespace strip to the
    // same key, so they share one entry: the padded call hits the array the
    // bare call stored.
    const a = new Analyzer(makeLexDb(), { normMap: null, cacheSize: 10 });
    const bare = a.analyze('\u0628\u0643\u062a\u0628');
    expect(a.analyze('  \u0628\u0643\u062a\u0628  ')).toBe(bare);
    expect(a.analyze('\u3000\u0628\u0643\u062a\u0628\t')).toBe(bare);
    expect(a.analyze('\u0628\u0643\u062a\u0628')).toBe(bare);
  });

  it('returns [] for a word that strips to empty without filling the cache', () => {
    const a = new Analyzer(makeLexDb(), { normMap: null, cacheSize: 10 });
    const cache = a['cache'] as LfuCache<Analysis[]>;
    for (const blank of ['', ' ', '\u00a0\u3000', '\t\n']) {
      expect(a.analyze(blank)).toEqual([]);
    }
    expect(cache.size).toBe(0);
  });
});

describe('Analyzer analyzeWords', () => {
  it('returns one { word, analyses } per input in order, each equal to analyze(word)', () => {
    const a = new Analyzer(makeFullDb(), { normMap: null });
    const words = ['123', '\u0628\u0643\u062a\u0628', '!!', 'hello'];
    const batch = a.analyzeWords(words);
    expect(batch).toHaveLength(words.length);
    for (let i = 0; i < words.length; i++) {
      expect(batch[i]!.word).toBe(words[i]);
      expect(batch[i]!.analyses).toEqual(a.analyze(words[i]!));
    }
  });

  it('preserves input order including duplicates', () => {
    const a = new Analyzer(makeDb());
    const batch = a.analyzeWords(['123', '!!', '123']);
    expect(batch.map((w) => w.word)).toEqual(['123', '!!', '123']);
  });
});

describe('Analyzer allFeats/tokFeats', () => {
  it('allFeats returns the database defines keys', () => {
    const db = makeDb();
    const a = new Analyzer(db);
    expect(a.allFeats()).toEqual(new Set(db.defines.keys()));
  });

  it('tokFeats returns the database tokenizations', () => {
    // Build a db with a non-empty tokenizations set and confirm it forwards.
    const db = makeDb(undefined, (init) => {
      init.tokenizations = new Set(['atbtok', 'd3tok']);
    });
    const a = new Analyzer(db);
    expect(a.tokFeats()).toEqual(new Set(['atbtok', 'd3tok']));
  });

  it('returns a fresh set each call so a caller cannot disturb the model', () => {
    const db = makeDb();
    const a = new Analyzer(db);
    const feats = a.allFeats();
    feats.add('intruder');
    expect(a.allFeats().has('intruder')).toBe(false);
  });
});
