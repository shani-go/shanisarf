// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the `Generator` over a small hand-made ALMOR text (`MINI_DB`
// in tests/support/generation-mini-db.ts, invented words). Every expected
// output was recorded by running CAMeL Tools 1.6.0's `Generator` over
// `MorphologyDB(path, 'r')` loaded from the same text, and is compared as a
// multiset in Canonical_Order. Where CAMeL Tools raises `KeyError`, the
// expected output is the Defined_Twin's: CAMeL Tools over the same text with
// the lemma-hash stems answering a missing `vox`/`rat`/`pos` with a value equal
// to nothing.

import { describe, expect, it } from 'vitest';

import { parseAlmor } from './almor-parser.js';
import type { Analysis } from './analyzer.js';
import { MorphologyDb } from './database.js';
import { GeneratorError } from './errors.js';
import { Generator } from './generator.js';
import { MINI_DB } from '../../tests/support/generation-mini-db.js';

/** A sort key: the analysis's entries sorted by key, as JSON. */
function sortKey(analysis: Analysis): string {
  return JSON.stringify(Object.entries(analysis).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Analyses in a fixed order, so lists compare as multisets. */
function sorted(analyses: readonly Analysis[]): Analysis[] {
  return [...analyses].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
}

interface Case {
  lemma: string;
  feats: Record<string, string>;
  expected?: Analysis[];
  error?: { type: string; message: string };
}

/** Each step of the generator and CAMeL Tools' results for it. */
const STEPS: [string, Case[]][] = [
  [
    "(a) strips the lemma: `_1` and `-a` suffixes look up the same lemma",
    [
      {
        lemma: "كِتاب",
        feats: {"pos": "noun"},
        expected: [{"diac": "كُتُب", "gen": "m", "lex": "كِتاب", "num": "p", "pos": "noun", "stem": "كُتُب", "stemcat": "N1", "stemgloss": "", "stt": "i"}, {"diac": "كِتاب", "gen": "m", "lex": "كِتاب", "num": "s", "pos": "noun", "rat": "n", "stem": "كِتاب", "stemcat": "N0", "stemgloss": "", "stt": "i"}],
      },
      {
        lemma: "كِتاب_1",
        feats: {"pos": "noun"},
        expected: [{"diac": "كُتُب", "gen": "m", "lex": "كِتاب", "num": "p", "pos": "noun", "stem": "كُتُب", "stemcat": "N1", "stemgloss": "", "stt": "i"}, {"diac": "كِتاب", "gen": "m", "lex": "كِتاب", "num": "s", "pos": "noun", "rat": "n", "stem": "كِتاب", "stemcat": "N0", "stemgloss": "", "stt": "i"}],
      },
      {
        lemma: "كِتاب-a",
        feats: {"pos": "noun"},
        expected: [{"diac": "كُتُب", "gen": "m", "lex": "كِتاب", "num": "p", "pos": "noun", "stem": "كُتُب", "stemcat": "N1", "stemgloss": "", "stt": "i"}, {"diac": "كِتاب", "gen": "m", "lex": "كِتاب", "num": "s", "pos": "noun", "rat": "n", "stem": "كِتاب", "stemcat": "N0", "stemgloss": "", "stt": "i"}],
      }
    ],
  ],
  [
    "(a) an unknown lemma returns [] before validating an invalid request",
    [
      {
        lemma: "nope",
        feats: {"xyz": "1"},
        expected: [],
      }
    ],
  ],
  [
    "(b) the first undefined key in insertion order throws InvalidGeneratorFeature",
    [
      {
        lemma: "كِتاب",
        feats: {"xyz": "1", "abc": "2"},
        error: { type: "InvalidGeneratorFeature", message: "Invalid feature 'xyz'" },
      }
    ],
  ],
  [
    "(b) a value outside a closed define throws InvalidGeneratorFeatureValue",
    [
      {
        lemma: "كِتاب",
        feats: {"pos": "noun", "gen": "x"},
        error: { type: "InvalidGeneratorFeatureValue", message: "Invalid value 'x' for feature 'gen'" },
      },
      {
        lemma: "كِتاب",
        feats: {"pos": "noun", "stt": "na", "prc0": "q"},
        error: { type: "InvalidGeneratorFeatureValue", message: "Invalid value 'q' for feature 'prc0'" },
      }
    ],
  ],
  [
    "(c) a missing pos prints None, an undefined pos its value",
    [
      {
        lemma: "كِتاب",
        feats: {"gen": "m"},
        error: { type: "InvalidGeneratorFeatureValue", message: "Invalid value None for feature 'pos'" },
      },
      {
        lemma: "كِتاب",
        feats: {"pos": "pron"},
        error: { type: "InvalidGeneratorFeatureValue", message: "Invalid value 'pron' for feature 'pos'" },
      }
    ],
  ],
  [
    "(d) a key outside the pos row of DEFAULTS returns []",
    [
      {
        lemma: "كَبِير",
        feats: {"pos": "adj", "asp": "p"},
        expected: [],
      }
    ],
  ],
  [
    "(d) a key in the pos row passes even when no stem carries it",
    [
      {
        lemma: "كِتاب",
        feats: {"pos": "noun", "asp": "p"},
        expected: [{"diac": "كُتُب", "gen": "m", "lex": "كِتاب", "num": "p", "pos": "noun", "stem": "كُتُب", "stemcat": "N1", "stemgloss": "", "stt": "i"}, {"diac": "كِتاب", "gen": "m", "lex": "كِتاب", "num": "s", "pos": "noun", "rat": "n", "stem": "كِتاب", "stemcat": "N0", "stemgloss": "", "stt": "i"}],
      }
    ],
  ],
  [
    "(d) a `*` clitic default fills null, which no merged value equals",
    [
      {
        lemma: "كَبِير",
        feats: {"pos": "adj"},
        expected: [],
      },
      {
        lemma: "كَبِير",
        feats: {"pos": "adj", "prc0": "Al_det"},
        expected: [{"diac": "الكَبِير", "gen": "m", "lex": "كَبِير", "num": "s", "pos": "adj", "prc0": "Al_det", "stem": "كَبِير", "stemcat": "A0", "stemgloss": "", "stt": "i"}],
      }
    ],
  ],
  [
    "(e) the stem filter on vox, and on a requested feature the merge confirms",
    [
      {
        lemma: "كَتَب",
        feats: {"pos": "verb"},
        expected: [{"asp": "i", "diac": "يَكْتُب", "gen": "m", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كْتُب", "stemcat": "V2", "stemgloss": "", "vox": "a"}, {"asp": "p", "diac": "كَتَب", "gen": "m", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كَتَب", "stemcat": "V0", "stemgloss": "", "vox": "a"}, {"asp": "p", "diac": "كَتَبَتْ", "gen": "f", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كَتَب", "stemcat": "V0", "stemgloss": "", "vox": "a"}, {"asp": "p", "diac": "كُتِب", "gen": "m", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كُتِب", "stemcat": "V1", "stemgloss": "", "vox": "p"}],
      },
      {
        lemma: "كَتَب",
        feats: {"pos": "verb", "vox": "p"},
        expected: [{"asp": "p", "diac": "كُتِب", "gen": "m", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كُتِب", "stemcat": "V1", "stemgloss": "", "vox": "p"}],
      },
      {
        lemma: "كِتاب",
        feats: {"pos": "noun", "num": "p"},
        expected: [{"diac": "كُتُب", "gen": "m", "lex": "كِتاب", "num": "p", "pos": "noun", "stem": "كُتُب", "stemcat": "N1", "stemgloss": "", "stt": "i"}],
      }
    ],
  ],
  [
    "(e) a stem lacking a requested rat is skipped, not thrown",
    [
      {
        lemma: "كِتاب",
        feats: {"pos": "noun", "rat": "n"},
        // CAMeL Tools raises KeyError('rat'); expected is the Defined_Twin's output.
        expected: [{"diac": "كِتاب", "gen": "m", "lex": "كِتاب", "num": "s", "pos": "noun", "rat": "n", "stem": "كِتاب", "stemcat": "N0", "stemgloss": "", "stt": "i"}],
      }
    ],
  ],
  [
    "(f) the prefix filter on prc0 and prc1",
    [
      {
        lemma: "كِتاب",
        feats: {"pos": "noun", "prc0": "Al_det"},
        expected: [{"diac": "الكُتُب", "gen": "m", "lex": "كِتاب", "num": "p", "pos": "noun", "stem": "كُتُب", "stemcat": "N1", "stemgloss": "", "stt": "i"}, {"diac": "الكِتاب", "gen": "m", "lex": "كِتاب", "num": "s", "pos": "noun", "rat": "n", "stem": "كِتاب", "stemcat": "N0", "stemgloss": "", "stt": "i"}],
      },
      {
        lemma: "كِتاب",
        feats: {"pos": "noun", "prc0": "0"},
        expected: [{"diac": "كُتُب", "gen": "m", "lex": "كِتاب", "num": "p", "pos": "noun", "stem": "كُتُب", "stemcat": "N1", "stemgloss": "", "stt": "i"}, {"diac": "كِتاب", "gen": "m", "lex": "كِتاب", "num": "s", "pos": "noun", "rat": "n", "stem": "كِتاب", "stemcat": "N0", "stemgloss": "", "stt": "i"}],
      },
      {
        lemma: "كَتَب",
        feats: {"pos": "verb", "prc1": "wa_conj"},
        expected: [{"asp": "p", "diac": "وَكَتَب", "gen": "m", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كَتَب", "stemcat": "V0", "stemgloss": "", "vox": "a"}, {"asp": "p", "diac": "وَكَتَبَتْ", "gen": "f", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كَتَب", "stemcat": "V0", "stemgloss": "", "vox": "a"}],
      },
      {
        lemma: "كَتَب",
        feats: {"pos": "verb", "asp": "i"},
        expected: [{"asp": "i", "diac": "يَكْتُب", "gen": "m", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كْتُب", "stemcat": "V2", "stemgloss": "", "vox": "a"}],
      }
    ],
  ],
  [
    "(g) the suffix filter on enc0 with the AC test",
    [
      {
        lemma: "كِتاب",
        feats: {"pos": "noun", "enc0": "3ms_poss"},
        expected: [{"diac": "كِتابهُ", "gen": "m", "lex": "كِتاب", "num": "s", "pos": "noun", "rat": "n", "stem": "كِتاب", "stemcat": "N0", "stemgloss": "", "stt": "i"}],
      },
      {
        lemma: "كِتاب",
        feats: {"pos": "noun", "prc1": "wa_conj", "enc0": "3ms_poss"},
        expected: [{"diac": "وَكِتابهُ", "gen": "m", "lex": "كِتاب", "num": "s", "pos": "noun", "rat": "n", "stem": "كِتاب", "stemcat": "N0", "stemgloss": "", "stt": "i"}],
      }
    ],
  ],
  [
    "(h) the final filter drops a merge disagreeing with the request",
    [
      {
        lemma: "كَتَب",
        feats: {"pos": "verb", "gen": "f"},
        expected: [{"asp": "p", "diac": "كَتَبَتْ", "gen": "f", "lex": "كَتَب", "num": "s", "per": "3", "pos": "verb", "stem": "كَتَب", "stemcat": "V0", "stemgloss": "", "vox": "a"}],
      }
    ],
  ],
];

const db = parseAlmor(MINI_DB, { flags: 'r' });
const generator = new Generator(db);

describe('Generator: constructor', () => {
  it('refuses a value that is not a MorphologyDb', () => {
    expect(() => new Generator({} as MorphologyDb)).toThrow(
      new GeneratorError('DB is not an instance of MorphologyDB'),
    );
  });

  it('refuses a model parsed without generation', () => {
    const a = parseAlmor(MINI_DB, { flags: 'a' });
    let thrown: unknown;
    try {
      new Generator(a);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GeneratorError);
    expect((thrown as Error).message).toBe('DB does not support generation');
  });

  it('accepts a g-only model', () => {
    expect(() => new Generator(parseAlmor(MINI_DB, { flags: 'g' }))).not.toThrow();
  });
});

describe('Generator: generate', () => {
  for (const [step, cases] of STEPS) {
    it(step, () => {
      for (const c of cases) {
        if (c.error !== undefined) {
          let thrown: unknown;
          try {
            generator.generate(c.lemma, c.feats);
          } catch (err) {
            thrown = err;
          }
          expect((thrown as Error).name, `${c.lemma} ${JSON.stringify(c.feats)}`).toBe(c.error.type);
          expect((thrown as Error).message).toBe(c.error.message);
        } else {
          expect(sorted(generator.generate(c.lemma, c.feats)), `${c.lemma} ${JSON.stringify(c.feats)}`).toEqual(
            sorted(c.expected as Analysis[]),
          );
        }
      }
    });
  }

  it('does not mutate the request or the stem entries', () => {
    const feats = { pos: 'noun', prc0: 'Al_det' };
    generator.generate('كِتاب', feats);
    expect(feats).toEqual({ pos: 'noun', prc0: 'Al_det' });
    for (const entries of db.lemmaHash.values()) {
      for (const entry of entries) {
        expect(Object.keys(entry.features)).not.toContain('stemcat');
      }
    }
  });

  it('a missing DEFAULTS row for a defined pos is a GeneratorError naming it', () => {
    const noRow = parseAlmor(MINI_DB.replace(/^DEFAULT pos:adj .*\n/mu, ''), { flags: 'r' });
    expect(() => new Generator(noRow).generate('كَبِير', { pos: 'adj' })).toThrow(
      new GeneratorError("No DEFAULTS row for pos 'adj'"),
    );
  });

  it('an open pos define skips the membership test', () => {
    const open = parseAlmor(
      MINI_DB.replace(/^DEFINE pos .*$/mu, 'DEFINE pos pos:*open*'),
      { flags: 'r' },
    );
    const results = new Generator(open).generate('كَتَب', { pos: 'verb', gen: 'f' });
    expect(results.map((a) => a['diac'])).toEqual(['كَتَبَتْ']);
  });
});

describe('Generator: allFeats and tokFeats', () => {
  it('forward to the database', () => {
    expect(generator.allFeats()).toEqual(db.allFeats());
    expect(generator.tokFeats()).toEqual(new Set(['diac']));
  });
});
