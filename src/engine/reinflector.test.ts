// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the `Reinflector` over the hand-made `MINI_DB` and
// `DEDUP_DB` (tests/support/generation-mini-db.ts). Every expected output was
// recorded by running CAMeL Tools 1.6.0's `Reinflector` over
// `MorphologyDB(path, 'r')` loaded from the same text, and is compared as a
// multiset. Where CAMeL Tools raises `KeyError: 'rat'`, the expected output is
// the Defined_Twin's.

import { describe, expect, it } from 'vitest';

import { parseAlmor } from './almor-parser.js';
import type { Analysis } from './analyzer.js';
import { MorphologyDb } from './database.js';
import { AnalyzerError, ReinflectorError } from './errors.js';
import {
  ANY_FEATS,
  CLITIC_FEATS,
  CLITIC_IGNORED_FEATS,
  IGNORED_FEATS,
  Reinflector,
  SPECIFIED_FEATS,
} from './reinflector.js';
import { DEDUP_DB, MINI_DB } from '../../tests/support/generation-mini-db.js';

/** A sort key: the analysis's entries sorted by key, as JSON. */
function sortKey(analysis: Analysis): string {
  return JSON.stringify(Object.entries(analysis).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Analyses in a fixed order, so lists compare as multisets. */
function sorted(analyses: readonly Analysis[]): Analysis[] {
  return [...analyses].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
}

interface Case {
  word: string;
  feats: Record<string, string>;
  expected?: Analysis[];
  error?: { type: string; message: string };
}

/** Each step of the reinflector and CAMeL Tools' results for it. */
const STEPS: [string, Case[]][] = [
  [
    "(a) an unanalyzable word returns [] before validating an invalid request",
    [
      {
        word: "ززز",
        feats: {"xyz": "1"},
        expected: [],
      }
    ],
  ],
  [
    "(b) validation: an undefined key, a value outside the define, ANY outside ANY_FEATS",
    [
      {
        word: "كتاب",
        feats: {"xyz": "1"},
        error: { type: "InvalidReinflectorFeature", message: "Invalid feature 'xyz'" },
      },
      {
        word: "كتاب",
        feats: {"num": "q"},
        error: { type: "InvalidReinflectorFeatureValue", message: "Invalid value 'q' for feature 'num'" },
      },
      {
        word: "كتاب",
        feats: {"rat": "ANY"},
        error: { type: "InvalidReinflectorFeatureValue", message: "Invalid value 'ANY' for feature 'rat'" },
      }
    ],
  ],
  [
    "(b) ANY passes for an ANY_FEATS key and is left out of the request",
    [
      {
        word: "كتب",
        feats: {"num": "ANY"},
        expected: [{"asp": "p", "diac": "كَتَب", "gen": "m", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كَتَب", "stemcat": "V0", "stemgloss": "", "vox": "a"}, {"asp": "p", "diac": "كُتِب", "gen": "m", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كُتِب", "stemcat": "V1", "stemgloss": "", "vox": "p"}, {"diac": "كُتُب", "gen": "m", "lex": "كِتاب", "num": "p", "pos": "noun", "stem": "كُتُب", "stemcat": "N1", "stemgloss": "", "stt": "i"}, {"diac": "كِتاب", "gen": "m", "lex": "كِتاب", "num": "s", "pos": "noun", "rat": "n", "stem": "كِتاب", "stemcat": "N0", "stemgloss": "", "stt": "i"}],
      }
    ],
  ],
  [
    "(d) the word is not stripped: a padded word returns []",
    [
      {
        word: " كتاب",
        feats: {"num": "p"},
        expected: [],
      }
    ],
  ],
  [
    "(d) the pos and lex filters",
    [
      {
        word: "كتب",
        feats: {"pos": "noun"},
        expected: [{"diac": "كُتُب", "gen": "m", "lex": "كِتاب", "num": "p", "pos": "noun", "stem": "كُتُب", "stemcat": "N1", "stemgloss": "", "stt": "i"}],
      },
      {
        word: "كتب",
        feats: {"lex": "كِتاب"},
        expected: [{"diac": "كُتُب", "gen": "m", "lex": "كِتاب", "num": "p", "pos": "noun", "stem": "كُتُب", "stemcat": "N1", "stemgloss": "", "stt": "i"}],
      },
      {
        word: "كتب",
        feats: {"lex": "كَتَب"},
        expected: [{"asp": "p", "diac": "كَتَب", "gen": "m", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كَتَب", "stemcat": "V0", "stemgloss": "", "vox": "a"}, {"asp": "p", "diac": "كُتِب", "gen": "m", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كُتِب", "stemcat": "V1", "stemgloss": "", "vox": "p"}],
      },
      {
        word: "كتب",
        feats: {"pos": "verb", "gen": "f"},
        expected: [{"asp": "p", "diac": "كَتَبَتْ", "gen": "f", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كَتَب", "stemcat": "V0", "stemgloss": "", "vox": "a"}],
      }
    ],
  ],
  [
    "(e) a requested value replaces the analysis value",
    [
      {
        word: "كتب",
        feats: {"vox": "p"},
        expected: [{"asp": "p", "diac": "كُتِب", "gen": "m", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كُتِب", "stemcat": "V1", "stemgloss": "", "vox": "p"}, {"diac": "كُتُب", "gen": "m", "lex": "كِتاب", "num": "p", "pos": "noun", "stem": "كُتُب", "stemcat": "N1", "stemgloss": "", "stt": "i"}],
      },
      {
        word: "كتب",
        feats: {"gen": "f"},
        expected: [{"asp": "p", "diac": "كَتَبَتْ", "gen": "f", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كَتَب", "stemcat": "V0", "stemgloss": "", "vox": "a"}],
      },
      {
        word: "كتبت",
        feats: {"gen": "m"},
        expected: [{"asp": "p", "diac": "كَتَب", "gen": "m", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كَتَب", "stemcat": "V0", "stemgloss": "", "vox": "a"}],
      },
      {
        word: "كتب",
        feats: {"asp": "p"},
        expected: [{"asp": "p", "diac": "كَتَب", "gen": "m", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كَتَب", "stemcat": "V0", "stemgloss": "", "vox": "a"}, {"asp": "p", "diac": "كُتِب", "gen": "m", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كُتِب", "stemcat": "V1", "stemgloss": "", "vox": "p"}, {"diac": "كُتُب", "gen": "m", "lex": "كِتاب", "num": "p", "pos": "noun", "stem": "كُتُب", "stemcat": "N1", "stemgloss": "", "stt": "i"}],
      },
      {
        word: "كتب",
        feats: {"per": "3"},
        expected: [{"asp": "p", "diac": "كَتَب", "gen": "m", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كَتَب", "stemcat": "V0", "stemgloss": "", "vox": "a"}, {"asp": "p", "diac": "كُتِب", "gen": "m", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كُتِب", "stemcat": "V1", "stemgloss": "", "vox": "p"}, {"diac": "كُتُب", "gen": "m", "lex": "كِتاب", "num": "p", "pos": "noun", "stem": "كُتُب", "stemcat": "N1", "stemgloss": "", "stt": "i"}],
      },
      {
        word: "كبير",
        feats: {"gen": "m"},
        expected: [{"diac": "كَبِير", "gen": "m", "lex": "كَبِير", "num": "s", "pos": "adj", "prc0": "0", "stem": "كَبِير", "stemcat": "A0", "stemgloss": "", "stt": "i"}],
      }
    ],
  ],
  [
    "(e) a requested key the analysis does not carry is not passed on",
    [
      {
        word: "والكتابه",
        feats: {"num": "p"},
        expected: [],
      }
    ],
  ],
  [
    "(e) with a clitic requested, stt is dropped from the request",
    [
      {
        word: "كتاب",
        feats: {"stt": "d"},
        // CAMeL Tools raises KeyError('rat'); expected is the Defined_Twin's output.
        expected: [],
      },
      {
        word: "كتاب",
        feats: {"prc0": "Al_det", "stt": "d"},
        // CAMeL Tools raises KeyError('rat'); expected is the Defined_Twin's output.
        expected: [{"diac": "كِتاب", "gen": "m", "lex": "كِتاب", "num": "s", "pos": "noun", "rat": "n", "stem": "كِتاب", "stemcat": "N0", "stemgloss": "", "stt": "i"}],
      },
      {
        word: "كتاب",
        feats: {"prc0": "Al_det"},
        // CAMeL Tools raises KeyError('rat'); expected is the Defined_Twin's output.
        expected: [{"diac": "كِتاب", "gen": "m", "lex": "كِتاب", "num": "s", "pos": "noun", "rat": "n", "stem": "كِتاب", "stemcat": "N0", "stemgloss": "", "stt": "i"}],
      },
      {
        word: "كتابه",
        feats: {"prc1": "wa_conj"},
        // CAMeL Tools raises KeyError('rat'); expected is the Defined_Twin's output.
        expected: [{"diac": "كِتاب", "gen": "m", "lex": "كِتاب", "num": "s", "pos": "noun", "rat": "n", "stem": "كِتاب", "stemcat": "N0", "stemgloss": "", "stt": "i"}],
      }
    ],
  ],
  [
    "(f) a stem lacking the analysis's rat is skipped, not thrown",
    [
      {
        word: "كتاب",
        feats: {"num": "p"},
        // CAMeL Tools raises KeyError('rat'); expected is the Defined_Twin's output.
        expected: [],
      }
    ],
  ],
];

const db = parseAlmor(MINI_DB, { flags: 'r' });
const reinflector = new Reinflector(db);

describe('Reinflector: constants', () => {
  it('are upstream\'s members', () => {
    expect([...CLITIC_FEATS].sort()).toEqual(['enc0', 'prc0', 'prc1', 'prc2', 'prc3']);
    expect(IGNORED_FEATS.size).toBe(28);
    expect([...SPECIFIED_FEATS].sort()).toEqual(['form_gen', 'form_num']);
    expect([...CLITIC_IGNORED_FEATS].sort()).toEqual(['cas', 'mod', 'stt']);
    expect([...ANY_FEATS].sort()).toEqual(['asp', 'cas', 'gen', 'mod', 'num', 'per', 'stt', 'vox']);
  });
});

describe('Reinflector: constructor', () => {
  it('refuses a value that is not a MorphologyDb', () => {
    expect(() => new Reinflector({} as MorphologyDb)).toThrow(
      new ReinflectorError('DB is not an instance of MorphologyDB'),
    );
  });

  it('refuses an a-only model as not supporting reinflection', () => {
    let thrown: unknown;
    try {
      new Reinflector(parseAlmor(MINI_DB, { flags: 'a' }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ReinflectorError);
    expect((thrown as Error).message).toBe('DB does not support reinflection');
  });

  it('a g-only model fails in the Analyzer it builds', () => {
    let thrown: unknown;
    try {
      new Reinflector(parseAlmor(MINI_DB, { flags: 'g' }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AnalyzerError);
    expect((thrown as Error).message).toBe('DB does not support analysis');
  });
});

describe('Reinflector: reinflect', () => {
  for (const [step, cases] of STEPS) {
    it(step, () => {
      for (const c of cases) {
        if (c.error !== undefined) {
          let thrown: unknown;
          try {
            reinflector.reinflect(c.word, c.feats);
          } catch (err) {
            thrown = err;
          }
          expect((thrown as Error).name, `${c.word} ${JSON.stringify(c.feats)}`).toBe(c.error.type);
          expect((thrown as Error).message).toBe(c.error.message);
        } else {
          expect(sorted(reinflector.reinflect(c.word, c.feats)), `${c.word} ${JSON.stringify(c.feats)}`).toEqual(
            sorted(c.expected as Analysis[]),
          );
        }
      }
    });
  }

  it('(e) an na analysis value for a requested key skips the analysis', () => {
    // The noun stems of MINI_DB carry no vox; give one the value na. CAMeL
    // Tools, run on the same text, skips that analysis for a vox request
    // and returns only the passive verb reading.
    const naDb = parseAlmor(
      MINI_DB.replace('lex:كِتاب_1 pos:noun gen:m num:p stt:i', 'lex:كِتاب_1 pos:noun gen:m num:p stt:i vox:na'),
      { flags: 'r' },
    );
    const results = new Reinflector(naDb).reinflect('كتب', { vox: 'p' });
    expect(results.map((a) => a['diac'])).toEqual(['كُتِب']);
  });

  it('(g) dedup keeps two results equal as dictionaries but in different key order', () => {
    // CAMeL Tools on DEDUP_DB: generate('كُتُب', {pos: 'noun'}) returns 3,
    // reinflect('كتب', {num: 'p'}) returns 2 with the key orders below.
    const dedup = new Reinflector(parseAlmor(DEDUP_DB, { flags: 'r' }));
    const results = dedup.reinflect('كتب', { num: 'p' });
    expect(results.map((a) => Object.keys(a).slice(0, 6))).toEqual([
      ['diac', 'lex', 'pos', 'gen', 'num', 'stt'],
      ['diac', 'lex', 'num', 'gen', 'pos', 'stt'],
    ]);
    expect(sortKey(results[0] as Analysis)).toBe(sortKey(results[1] as Analysis));
  });
});

describe('Reinflector: allFeats and tokFeats', () => {
  it('forward to the database', () => {
    expect(reinflector.allFeats()).toEqual(db.allFeats());
    expect(reinflector.tokFeats()).toEqual(db.tokFeats());
  });
});
