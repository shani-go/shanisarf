// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Dediacritization removes exactly the diacritics. For any string over an
// encoding's own characters (letters, its diacritics, and a little noise: an
// alef variant, a space, an astral emoji), each of the five `dediac_*`
// functions leaves no diacritic of its set, preserves every other code point
// in order, is idempotent, and shortens the string by exactly the number of
// diacritics it carried. Pieces are single code points and words stay short,
// so a counterexample shrinks to a short, readable word.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  AR_DIAC_CHARSET,
  AR_LETTERS_CHARSET,
  BW_DIAC_CHARSET,
  BW_LETTERS_CHARSET,
  HSB_DIAC_CHARSET,
  HSB_LETTERS_CHARSET,
  SAFEBW_DIAC_CHARSET,
  SAFEBW_LETTERS_CHARSET,
  XMLBW_DIAC_CHARSET,
  XMLBW_LETTERS_CHARSET,
} from './charsets.js';
import {
  dediacAr,
  dediacBw,
  dediacHsb,
  dediacSafebw,
  dediacXmlbw,
} from './dediac.js';
import { codePoints, pyLen } from './python-compat.js';

const NUM_RUNS = 200;
const PER_TEST = { timeout: 20_000 } as const;

// A handful of code points that are not in any encoding's diacritic set, so
// the "keeps every other code point" clause meets real non-diacritic input:
// an off-set Arabic alef variant, ASCII punctuation, a space, and an astral
// emoji (one code point, two UTF-16 units — the dediac regex is code-point
// aware with the `u` flag, so it must pass through whole).
const NON_DIAC_NOISE = ['\u0627', '-', '_', '.', ' ', '\u{1F600}'];

interface Encoding {
  readonly name: string;
  readonly dediac: (s: string) => string;
  readonly diac: ReadonlySet<string>;
  readonly letters: ReadonlySet<string>;
}

const ENCODINGS: readonly Encoding[] = [
  {
    name: 'dediacAr',
    dediac: dediacAr,
    diac: AR_DIAC_CHARSET,
    letters: AR_LETTERS_CHARSET,
  },
  {
    name: 'dediacBw',
    dediac: dediacBw,
    diac: BW_DIAC_CHARSET,
    letters: BW_LETTERS_CHARSET,
  },
  {
    name: 'dediacSafebw',
    dediac: dediacSafebw,
    diac: SAFEBW_DIAC_CHARSET,
    letters: SAFEBW_LETTERS_CHARSET,
  },
  {
    name: 'dediacXmlbw',
    dediac: dediacXmlbw,
    diac: XMLBW_DIAC_CHARSET,
    letters: XMLBW_LETTERS_CHARSET,
  },
  {
    name: 'dediacHsb',
    dediac: dediacHsb,
    diac: HSB_DIAC_CHARSET,
    letters: HSB_LETTERS_CHARSET,
  },
];

/**
 * A word arbitrary for an encoding: each code point is drawn from the
 * encoding's letters, its diacritics (over-weighted by appearing in their own
 * pool), or the shared non-diacritic noise. Short words keep shrinking useful.
 */
function wordArb(enc: Encoding): fc.Arbitrary<string> {
  const alphabet = [...enc.letters, ...enc.diac, ...NON_DIAC_NOISE];
  const charArb = fc.constantFrom(...alphabet);
  return fc.array(charArb, { maxLength: 16 }).map((cps) => cps.join(''));
}

describe('Dediacritization removes exactly the diacritics', () => {
  for (const enc of ENCODINGS) {
    it(`${enc.name} removes exactly its diacritic set, preserving the rest in order`, PER_TEST, () => {
      fc.assert(
        fc.property(wordArb(enc), (s) => {
          const out = enc.dediac(s);

          // No diacritic of the set survives.
          for (const cp of codePoints(out)) {
            expect(enc.diac.has(cp)).toBe(false);
          }

          // Every non-diacritic code point is preserved, in order: the output
          // equals the input with exactly its diacritics filtered out.
          const expected = codePoints(s)
            .filter((cp) => !enc.diac.has(cp))
            .join('');
          expect(out).toBe(expected);

          // Idempotent: a second pass changes nothing (no diacritics remain).
          expect(enc.dediac(out)).toBe(out);

          // The length drop equals the number of diacritics removed.
          const diacCount = codePoints(s).filter((cp) =>
            enc.diac.has(cp),
          ).length;
          expect(pyLen(s) - pyLen(out)).toBe(diacCount);
        }),
        { numRuns: NUM_RUNS },
      );
    });
  }
});
