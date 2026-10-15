// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Special paths are total and exact, over the real Database_Pin (the digit,
// punc and foreign records are built from its `DEFAULTS` rows): each branch
// never throws and returns exactly the specified record, and the branches are
// taken in order (digit, punc, has-punc, foreign). Arbitraries are digit
// strings over the two digit scripts, punctuation/symbol strings, foreign
// strings over non-Arabic letters, and Python_Whitespace strings, so a shrunk
// counterexample is short and legible. Skips with a notice when `data/` lacks
// the pin.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  Analyzer,
  parseAlmor,
  type Analysis,
  type MorphologyDb,
} from '../../src/engine/index.js';
import { DB_PATH, databaseAvailable, SETUP_HINT } from '../parity/replay-support.js';
import { PY_WHITESPACE } from '../../src/engine/python-compat.js';

// ---------------------------------------------------------------------------
// Load the Database_Pin once, or skip the whole suite with a loud notice when
// `data/` lacks it (exactly as the parity replay suite and measure-db do).
// ---------------------------------------------------------------------------

const HAVE_DB = databaseAvailable();

let db: MorphologyDb | undefined;
function database(): MorphologyDb {
  if (db === undefined) {
    db = parseAlmor(readFileSync(DB_PATH, 'utf8'), { flags: 'a' });
  }
  return db;
}

if (!HAVE_DB) {
  console.warn(
    `\nspecial-paths property: SKIPPED — the Database_Pin is not present.\n` +
      `  expected at: ${DB_PATH}\n` +
      `  Fetch it with \`${SETUP_HINT}\` (the DB is CC BY 4.0 and never committed).\n` +
      `  This is not a failure; the build is unaffected.\n`,
  );
}

// ---------------------------------------------------------------------------
// Budgets: 20–50 runs, 60 s for a real-database property.
// ---------------------------------------------------------------------------

const NUM_RUNS = 40;
const PROP_OPTS = { numRuns: NUM_RUNS } as const;
const TEST_TIMEOUT = 60_000;

// ---------------------------------------------------------------------------
// Deliberate arbitraries: small pools, short lengths, so a shrink
// lands on a short word.
// ---------------------------------------------------------------------------

// ASCII digits and Arabic-Indic digits — the two scripts `IS_DIGIT` /
// `IS_STRICT_DIGIT` recognize (`[0-9\u0660-\u0669]`). Nothing else is a digit
// to the engine (Extended Arabic-Indic `\u06F0-\u06F9` is NOT, by upstream's
// regex), so these two pools are the whole strict-digit space.
const ASCII_DIGITS = '0123456789'.split('');
const ARABIC_INDIC_DIGITS = Array.from('\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669');
const DIGIT_POOL: readonly string[] = [...ASCII_DIGITS, ...ARABIC_INDIC_DIGITS];

/** A non-empty string of digits over the two recognized digit scripts. */
const digitString: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...DIGIT_POOL), { minLength: 1, maxLength: 6 })
  .map((cs) => cs.join(''));

// Punctuation and symbol code points, chosen deliberately to span `\p{P}` and
// `\p{S}` without reaching into the Unicode-version-sensitive fringe (the
// engine uses the host's `\p{P}`/`\p{S}`, so a drift-prone code point would
// make the host and CAMeL Tools disagree — out of scope for this property, which
// tests totality and exactness of the branch, not the Unicode boundary). All
// of these are stable punctuation/symbols across Unicode 15–17.
const PUNC_POOL: readonly string[] = Array.from('!?.,;:()[]{}«»…-—"\'/\\&%#@*+=<>|~^$');

/** A non-empty string of punctuation/symbol code points. */
const puncString: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...PUNC_POOL), { minLength: 1, maxLength: 6 })
  .map((cs) => cs.join(''));

// Foreign (non-Arabic) letters: Latin, Cyrillic and a few CJK ideographs.
// None are digits or punctuation, so a word built purely from these falls
// through digit/punc/has-punc to the foreign branch. Letters only (no spaces,
// no punctuation) so the whole word is `!IS_AR` and has no `\p{P}`/`\p{S}`.
const FOREIGN_POOL: readonly string[] = Array.from(
  'abcXYZ' + '\u0430\u0431\u0432\u0414\u0416' + '\u4e2d\u6587\u65e5\u672c',
);

/** A non-empty string of non-Arabic letters. */
const foreignString: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...FOREIGN_POOL), { minLength: 1, maxLength: 6 })
  .map((cs) => cs.join(''));

/** A non-empty string drawn only from Python_Whitespace (strips to ''). */
const whitespaceString: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...PY_WHITESPACE), { minLength: 1, maxLength: 6 })
  .map((cs) => cs.join(''));

// A short Arabic letter run, used to build a "has-punc but not all punc" word
// (an Arabic letter with punctuation attached) for the branch-order case.
const AR_LETTER_POOL: readonly string[] = Array.from('\u0643\u062a\u0628\u0644\u0645\u0646');
const arLetters: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...AR_LETTER_POOL), { minLength: 1, maxLength: 4 })
  .map((cs) => cs.join(''));

// ---------------------------------------------------------------------------
// The exact-record assertion, shared by digit/punc/foreign. It encodes the
// record's clauses: one analysis, the fixed fields, the nine
// tokenization features and `gloss` equal to the word, the three
// log-probabilities `-99`, `stemcat null`, and the key set equal to the
// DEFAULTS row's keys plus the added ones.
// ---------------------------------------------------------------------------

/** The nine tokenization/segmentation features the special paths copy. */
const TOK_FEATS = [
  'd1seg',
  'd2seg',
  'd3seg',
  'atbseg',
  'd1tok',
  'd2tok',
  'd3tok',
  'atbtok',
  'bwtok',
] as const;

interface PathSpec {
  readonly row: string;
  readonly source: string;
  readonly bwSuffix: string;
  readonly marker: string;
  readonly catib6: string;
  readonly ud: string;
  /** The `pos` the foreign path overrides to; `undefined` means "the row's pos". */
  readonly pos?: string;
}

const DIGIT_SPEC: PathSpec = {
  row: 'digit',
  source: 'digit',
  bwSuffix: '/NOUN_NUM',
  marker: 'DIGIT',
  catib6: 'NOM',
  ud: 'NUM',
};
const PUNC_SPEC: PathSpec = {
  row: 'punc',
  source: 'punc',
  bwSuffix: '/PUNC',
  marker: 'PUNC',
  catib6: 'PNX',
  ud: 'PUNCT',
};
const FOREIGN_SPEC: PathSpec = {
  row: 'latin',
  source: 'foreign',
  bwSuffix: '/FOREIGN',
  marker: 'FOREIGN',
  catib6: 'FOREIGN',
  ud: 'X',
  pos: 'foreign',
};

/**
 * Assert a special-path result against the exact record for `spec`.
 * `word` is the stripped word the analysis was built from.
 */
function assertSpecialRecord(
  theDb: MorphologyDb,
  result: Analysis[],
  word: string,
  spec: PathSpec,
): void {
  // Exactly one analysis (the branch is total and returns a single record).
  expect(result).toHaveLength(1);
  const an = result[0] as Analysis;

  // The fixed fields.
  expect(an['source']).toBe(spec.source);
  expect(an['diac']).toBe(word);
  expect(an['stem']).toBe(word);
  expect(an['stemgloss']).toBe(word);
  expect(an['lex']).toBe(word);
  expect(an['bw']).toBe(word + spec.bwSuffix);
  expect(an['stemcat']).toBeNull();

  // `pos`: the foreign path overrides to 'foreign'; digit/punc keep the row's
  // pos (which, in the pin, is the row name 'digit'/'punc').
  if (spec.pos !== undefined) {
    expect(an['pos']).toBe(spec.pos);
  } else {
    expect(an['pos']).toBe(spec.row);
  }

  // The nine tokenization features and `gloss` equal the word (COPY_FEATS).
  expect(an['gloss']).toBe(word);
  for (const feat of TOK_FEATS) {
    expect(an[feat]).toBe(word);
  }

  // root/pattern/caphi equal the path marker (UNDEFINED_LEX_FEATS).
  expect(an['root']).toBe(spec.marker);
  expect(an['pattern']).toBe(spec.marker);
  expect(an['caphi']).toBe(spec.marker);

  // catib6/ud fixed per path.
  expect(an['catib6']).toBe(spec.catib6);
  expect(an['ud']).toBe(spec.ud);

  // The three log-probabilities are the number -99 (not the string '-99.0').
  expect(an['pos_logprob']).toBe(-99);
  expect(an['lex_logprob']).toBe(-99);
  expect(an['pos_lex_logprob']).toBe(-99);
  expect(typeof an['pos_logprob']).toBe('number');

  // Key set equals the DEFAULTS row's keys plus the keys the path adds. Every
  // added key (diac, stem, stemgloss, stemcat, lex, bw, source, the copy and
  // undefined-lex feats, catib6, ud, the logprobs) is already present in the
  // pin's digit/punc/latin rows, so the two key sets coincide; this checks that no key was dropped and none invented.
  const row = theDb.defaults.get(spec.row) as Record<string, unknown>;
  const rowKeys = new Set(Object.keys(row));
  const added = [
    'diac',
    'stem',
    'stemgloss',
    'stemcat',
    'lex',
    'bw',
    'source',
    'gloss',
    'root',
    'pattern',
    'caphi',
    'catib6',
    'ud',
    'pos',
    'pos_logprob',
    'lex_logprob',
    'pos_lex_logprob',
    ...TOK_FEATS,
  ];
  const expectedKeys = new Set<string>(rowKeys);
  for (const k of added) {
    if (theDb.defines.has(k) || !UNGATED_ADDED.has(k)) {
      // COPY_FEATS/UNDEFINED_LEX_FEATS/catib6/ud are added only when defined;
      // the always-added fields are added unconditionally. In the pin every
      // such feature is defined, so this collapses to "all added keys".
      expectedKeys.add(k);
    }
  }
  expect(new Set(Object.keys(an))).toEqual(expectedKeys);
}

// The subset of `added` that is gated on `db.defines` membership (COPY_FEATS,
// UNDEFINED_LEX_FEATS, catib6, ud). The rest (diac, stem, …, the logprobs,
// pos, source) are added unconditionally.
const UNGATED_ADDED = new Set<string>([
  'gloss',
  'root',
  'pattern',
  'caphi',
  'catib6',
  'ud',
  ...TOK_FEATS,
]);

// ---------------------------------------------------------------------------
// One `it` per clause, each named for the invariant it holds.
// ---------------------------------------------------------------------------

describe('special paths are total and exact', () => {
  it.skipIf(!HAVE_DB)(
    'the digit path (non-strict) is total and returns the exact digit record',
    () => {
      const theDb = database();
      const analyzer = new Analyzer(theDb, { strictDigit: false });
      fc.assert(
        fc.property(digitString, (word) => {
          const result = analyzer.analyze(word);
          assertSpecialRecord(theDb, result, word, DIGIT_SPEC);
        }),
        PROP_OPTS,
      );
    },
    TEST_TIMEOUT,
  );

  it.skipIf(!HAVE_DB)(
    'the digit path (strict) is total and returns the exact digit record',
    () => {
      const theDb = database();
      const analyzer = new Analyzer(theDb, { strictDigit: true });
      fc.assert(
        fc.property(digitString, (word) => {
          const result = analyzer.analyze(word);
          assertSpecialRecord(theDb, result, word, DIGIT_SPEC);
        }),
        PROP_OPTS,
      );
    },
    TEST_TIMEOUT,
  );

  it.skipIf(!HAVE_DB)(
    'the punc path is total and returns the exact punc record',
    () => {
      const theDb = database();
      const analyzer = new Analyzer(theDb);
      fc.assert(
        fc.property(puncString, (word) => {
          const result = analyzer.analyze(word);
          assertSpecialRecord(theDb, result, word, PUNC_SPEC);
        }),
        PROP_OPTS,
      );
    },
    TEST_TIMEOUT,
  );

  it.skipIf(!HAVE_DB)(
    'the foreign path is total and returns the exact foreign record',
    () => {
      const theDb = database();
      const analyzer = new Analyzer(theDb);
      fc.assert(
        fc.property(foreignString, (word) => {
          const result = analyzer.analyze(word);
          assertSpecialRecord(theDb, result, word, FOREIGN_SPEC);
        }),
        PROP_OPTS,
      );
    },
    TEST_TIMEOUT,
  );

  it.skipIf(!HAVE_DB)(
    'a whitespace-only word returns []',
    () => {
      const theDb = database();
      const analyzer = new Analyzer(theDb);
      fc.assert(
        fc.property(whitespaceString, (word) => {
          expect(analyzer.analyze(word)).toEqual([]);
        }),
        PROP_OPTS,
      );
    },
    TEST_TIMEOUT,
  );

  it.skipIf(!HAVE_DB)(
    'branches are taken in order: digit before punc before has-punc before foreign',
    () => {
      const theDb = database();
      const analyzer = new Analyzer(theDb, { strictDigit: false });
      fc.assert(
        fc.property(
          digitString,
          puncString,
          foreignString,
          arLetters,
          (digits, punc, foreign, arabic) => {
            // digit beats punc: a word with a digit and punctuation is a
            // digit (IS_DIGIT matches any word containing a digit, checked
            // first).
            expect(analyzer.analyze(digits + punc)[0]?.['source']).toBe('digit');
            // digit beats foreign: a Latin word with a digit is a digit.
            expect(analyzer.analyze(foreign + digits)[0]?.['source']).toBe('digit');
            // punc beats foreign: an all-punctuation word is punc, never
            // foreign, even though it is also `!IS_AR`.
            expect(analyzer.analyze(punc)[0]?.['source']).toBe('punc');
            // has-punc beats foreign: an Arabic word with punctuation attached
            // is neither all-punc nor all-Arabic; the has-punc branch takes it
            // (no lexical lookup) and NONE-mode backoff adds nothing, so the
            // foreign record is never produced.
            const hasPunc = analyzer.analyze(arabic + punc);
            for (const an of hasPunc) {
              expect(an['source']).not.toBe('foreign');
            }
          },
        ),
        PROP_OPTS,
      );
    },
    TEST_TIMEOUT,
  );
});
