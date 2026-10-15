// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Segmentation is CAMeL Tools'. For a word of code-point length `n` (0..12)
// and bounds `maxPrefix`/`maxSuffix` (0..10), `segments` yields exactly the
// triples CAMeL Tools' double loop yields, in the same order:
//
//   for p in range(0, min(max_prefix_size, len(word) - 1) + 1):
//       for s in range(max(1, len(word) - p - max_suffix_size),
//                      len(word) - p + 1):
//           prefix, stem, suffix = word[:p], word[p:p+s], word[p+s:]
//
// compared against an independent translation of that loop. Every triple
// re-joins to the word, the stem is never empty, the bounds hold, the empty
// word yields nothing, and astral code points (injected deliberately) are
// never split.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { AR_CHARSET, AR_LETTERS_CHARSET } from './charsets.js';
import { codePoints, pyLen } from './python-compat.js';
import { type Segmentation, segments } from './segments.js';

const NUM_RUNS = 200;
const PER_TEST = { timeout: 20_000 } as const;

// A few astral (supplementary-plane) code points — each one code point but
// two UTF-16 code units. Dropped into the alphabet so a cut must never fall
// inside one; the reference and the engine both work over code points.
const ASTRAL = ['\u{1F600}', '\u{1F4A9}', '\u{1F914}', '\u{1F469}'];

// The alphabet a test word is drawn from: the database's Arabic letters and
// diacritics (AR_CHARSET), a couple of bare letters (AR_LETTERS_CHARSET, so a
// letter without a diacritic is common), and the astral code points. Single
// code points keep shrinking useful.
const ALPHABET = [...AR_CHARSET, ...AR_LETTERS_CHARSET, ...ASTRAL];

/**
 * A short word drawn from {@link ALPHABET}. Length 0..12 is the bound on `n` and includes the empty word.
 */
const wordArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...ALPHABET), { maxLength: 12 })
  .map((cps) => cps.join(''));

/** `maxPrefix` / `maxSuffix` in `0..10`. */
const boundArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 10 });

/**
 * An independent reimplementation of CAMeL Tools' double loop, written
 * fresh here (not by calling `segments`) so the property has something to
 * compare against. Works over the code-point array, exactly as Python's
 * slicing does.
 */
function referenceSegments(
  word: string,
  maxPrefix: number,
  maxSuffix: number,
): Segmentation[] {
  const w = codePoints(word);
  const n = w.length;
  const out: Segmentation[] = [];
  // Python's `range(0, min(maxPrefix, n - 1) + 1)`: empty when n = 0.
  const pMax = Math.min(maxPrefix, n - 1);
  for (let p = 0; p <= pMax; p++) {
    const sMin = Math.max(1, n - p - maxSuffix);
    const sMax = n - p;
    for (let s = sMin; s <= sMax; s++) {
      out.push({
        prefix: w.slice(0, p).join(''),
        stem: w.slice(p, p + s).join(''),
        suffix: w.slice(p + s, n).join(''),
      });
    }
  }
  return out;
}

describe("Segmentation is CAMeL Tools'", () => {
  it('yields exactly the reference double loop, in order, with every clause holding', PER_TEST, () => {
    fc.assert(
      fc.property(wordArb, boundArb, boundArb, (word, maxPrefix, maxSuffix) => {
        const actual = [...segments(word, maxPrefix, maxSuffix)];
        const expected = referenceSegments(word, maxPrefix, maxSuffix);

        // Same triples, same order as CAMeL Tools' loop.
        expect(actual).toEqual(expected);

        const wordCps = codePoints(word);
        for (const { prefix, stem, suffix } of actual) {
          // Each triple re-joins to the word over code points.
          expect(prefix + stem + suffix).toBe(word);

          // The stem is never empty.
          expect(stem.length).toBeGreaterThan(0);

          // Prefix/suffix lengths respect the bounds (code points, not units).
          expect(pyLen(prefix)).toBeLessThanOrEqual(maxPrefix);
          expect(pyLen(suffix)).toBeLessThanOrEqual(maxSuffix);

          // Astral code points are never split: concatenating the parts'
          // code-point arrays reconstructs the word's code-point array, so no
          // cut fell inside a surrogate pair (which would leave a lone
          // surrogate and break this equality).
          expect([
            ...codePoints(prefix),
            ...codePoints(stem),
            ...codePoints(suffix),
          ]).toEqual(wordCps);
        }

        // The empty word yields nothing.
        if (word === '') {
          expect(actual).toHaveLength(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
