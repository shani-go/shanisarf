// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The canonical key is shared and total. For any list of analyses with random
// feature values (strings with quotes, backslashes, Arabic, astral and control
// characters; integral and fractional numbers; null): `canonicalKey` equals the
// key `tools/parity/canonical.py` recorded for the committed vector, and its
// serialization rules (sorted keys, compact separators, non-ASCII unescaped,
// integral numbers with no `.0`) hold, so a drift from the Python half shows
// up; it is deterministic and independent of key insertion order; and
// `canonicalOrder` keeps duplicates, is idempotent, ignores input order, does
// not mutate its input, and sorts by `canonicalKey`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type Analysis, canonicalKey, canonicalOrder } from './canonical';

const NUM_RUNS = 200;
const PER_TEST = { timeout: 20_000 } as const;

// The committed shared vector, re-affirmed here so a drift between the two
// serializers (or an edit to the vector) fails this property as well as the
// example test.
interface Vector {
  name: string;
  analysis: Analysis;
  canonicalKey: string;
}
interface VectorFile {
  vectors: Vector[];
}
const vectorPath = fileURLToPath(
  new URL('../../fixtures/meta/canonical-vector.json', import.meta.url),
);
const vectorFile = JSON.parse(readFileSync(vectorPath, 'utf8')) as VectorFile;

// Realistic feature keys: the ASCII keys an analysis actually carries, plus a
// couple of non-ASCII (Arabic) keys so the "sorted keys" rule meets the full
// UTF-16 order the Python half mirrors, not only ASCII.
const KEY_POOL = [
  'diac',
  'lex',
  'bw',
  'gloss',
  'pos',
  'stem',
  'stemcat',
  'root',
  'pattern',
  'caphi',
  'num',
  'gen',
  'pos_logprob',
  'lex_logprob',
  'pos_lex_logprob',
  'كلمة',
  'جذر',
];

// Code points a string Feature_Value is built from: ASCII letters and the
// JSON-sensitive characters (quote, backslash, control), non-ASCII Arabic
// (letters and diacritics), and astral code points (one code point, two
// UTF-16 units) so escaping, non-ASCII pass-through and surrogate handling are
// all exercised. Not `fc.string()`.
const STRING_CHAR_POOL = [
  // ASCII, including the characters JSON must escape.
  'a',
  'Z',
  '1',
  '_',
  ' ',
  '"',
  '\\',
  '\n',
  '\t',
  '\u0000',
  '\u001f',
  // Non-ASCII Arabic: letters and diacritics (kataba, rajul fragments).
  '\u0643', // ك
  '\u062a', // ت
  '\u0628', // ب
  '\u0631', // ر
  '\u062c', // ج
  '\u0644', // ل
  '\u064e', // fatha
  '\u064f', // damma
  '\u0650', // kasra
  '\u0652', // sukun
  // Astral code points (emoji) — two UTF-16 units each.
  '\u{1F600}',
  '\u{1F4A9}',
];

/** A string value drawn from {@link STRING_CHAR_POOL}; short, so shrinking helps. */
const stringValueArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...STRING_CHAR_POOL), { maxLength: 8 })
  .map((cps) => cps.join(''));

/**
 * A numeric value: integral values (including `-99`, the log-probability
 * default, which the number rule must print without a `.0`) and
 * non-integral values (a real log-probability keeps its digits). Both the
 * integer and the `.0`-valued double of an integral number are produced so
 * the "integral float prints as its integer" rule is exercised on the JS side.
 */
// Negative zero is excluded: an analysis never carries one, and `-0`
// canonicalizes to "0" on both sides (as it should), which would only make
// the round-trip equality check below spuriously distinguish `-0` from `+0`.
const numberValueArb: fc.Arbitrary<number> = fc
  .oneof(
    fc.constantFrom(-99, 0, 2, -1, 42),
    fc.constantFrom(-6.71828, -4.5, 1.5, -0.0001),
    fc.integer({ min: -1000, max: 1000 }),
    fc
      .float({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true })
      .filter((n) => Number.isFinite(n)),
  )
  .map((n) => (Object.is(n, -0) ? 0 : n));

/** One Feature_Value: a string, a number, or null — exactly what an analysis holds. */
const featureValueArb: fc.Arbitrary<string | number | null> = fc.oneof(
  stringValueArb,
  numberValueArb,
  fc.constant(null),
);

/**
 * An Analysis: a feature dictionary over a subset of {@link KEY_POOL} with
 * random Feature_Values. Keys are a set (object keys are unique); the value
 * for each is drawn independently.
 */
const analysisArb: fc.Arbitrary<Analysis> = fc
  .uniqueArray(fc.constantFrom(...KEY_POOL), { minLength: 0, maxLength: 8 })
  .chain((keys) =>
    fc
      .tuple(...keys.map(() => featureValueArb))
      .map((values) => {
        const analysis: Analysis = {};
        keys.forEach((key, i) => {
          analysis[key] = values[i] as string | number | null;
        });
        return analysis;
      }),
  );

/** A short list of analyses, so `canonicalOrder` meets duplicates and permutations. */
const analysisListArb: fc.Arbitrary<Analysis[]> = fc.array(analysisArb, {
  maxLength: 10,
});

/** A permutation of the entries of an analysis: same keys/values, shuffled insertion order. */
function shuffledKeysArb(analysis: Analysis): fc.Arbitrary<Analysis> {
  const entries = Object.entries(analysis);
  return fc.shuffledSubarray(entries, {
    minLength: entries.length,
    maxLength: entries.length,
  }).map((shuffled) => {
    const rebuilt: Analysis = {};
    for (const [k, v] of shuffled) {
      rebuilt[k] = v;
    }
    return rebuilt;
  });
}

describe('The canonical key is shared and total', () => {
  it('canonicalKey is deterministic and independent of key insertion order', PER_TEST, () => {
    fc.assert(
      fc.property(
        analysisArb.chain((analysis) =>
          fc.tuple(fc.constant(analysis), shuffledKeysArb(analysis)),
        ),
        ([analysis, shuffled]) => {
          const key = canonicalKey(analysis);
          // Deterministic: same analysis object → same key, twice over.
          expect(canonicalKey(analysis)).toBe(key);
          // Insertion-order independent: reordering the object's own keys
          // yields the identical Canonical_Key.
          expect(canonicalKey(shuffled)).toBe(key);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('canonicalKey obeys the serialization rules', PER_TEST, () => {
    fc.assert(
      fc.property(analysisArb, (analysis) => {
        const key = canonicalKey(analysis);
        const parsed = JSON.parse(key) as Analysis;

        // Round-trips to the same feature dictionary (values preserved).
        expect(parsed).toEqual(analysis);

        // Keys appear in ascending UTF-16 code-unit order (JS native sort).
        const emittedKeys = Object.keys(parsed);
        const sortedKeys = [...emittedKeys].sort();
        expect(emittedKeys).toEqual(sortedKeys);

        // Compact separators: no ", " or ": " outside string literals — the
        // emitted key equals JSON.stringify with keys inserted in sorted order
        // and no spacer argument.
        const ordered: Analysis = {};
        for (const k of sortedKeys) {
          ordered[k] = analysis[k] as string | number | null;
        }
        expect(key).toBe(JSON.stringify(ordered));

        // Integral numbers print without a fractional part; non-ASCII is left
        // unescaped — both follow from JSON.stringify, asserted per value.
        for (const [k, v] of Object.entries(analysis)) {
          if (typeof v === 'number' && Number.isInteger(v)) {
            // The number's serialization carries no '.' (e.g. -99, not -99.0).
            expect(JSON.stringify(v)).toBe(String(v));
            expect(key).toContain(`${JSON.stringify(k)}:${String(v)}`);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('canonicalOrder is a total order: multiset, idempotent, permutation-invariant, non-mutating, sorted', PER_TEST, () => {
    fc.assert(
      fc.property(
        analysisListArb.chain((list) =>
          fc.tuple(
            fc.constant(list),
            fc.shuffledSubarray(list, {
              minLength: list.length,
              maxLength: list.length,
            }),
          ),
        ),
        ([list, permuted]) => {
          const snapshot = list.map((a) => canonicalKey(a));

          const ordered = canonicalOrder(list);
          const orderedKeys = ordered.map((a) => canonicalKey(a));

          // Does not mutate its input (same objects, same order as before).
          expect(list.map((a) => canonicalKey(a))).toEqual(snapshot);
          // Returns a fresh array.
          expect(ordered).not.toBe(list);

          // Keeps duplicates (a multiset): same length and same key multiset.
          expect(ordered).toHaveLength(list.length);
          expect([...orderedKeys].sort()).toEqual([...snapshot].sort());

          // Output is non-decreasing in canonicalKey (sorted by the key).
          for (let i = 1; i < orderedKeys.length; i++) {
            expect(
              (orderedKeys[i - 1] as string) <= (orderedKeys[i] as string),
            ).toBe(true);
          }

          // Idempotent: sorting the sorted list changes nothing.
          expect(canonicalOrder(ordered).map((a) => canonicalKey(a))).toEqual(
            orderedKeys,
          );

          // Invariant under permutation of the input: any ordering of the same
          // multiset sorts to the same sequence of keys.
          expect(canonicalOrder(permuted).map((a) => canonicalKey(a))).toEqual(
            orderedKeys,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('the committed shared vector round-trips byte for byte', PER_TEST, () => {
    // Reaffirm the shared vector that both halves pin to: every vector's
    // analysis serializes to its recorded Canonical_Key. The Python half
    // checks the same vector in the harness, so this is the "shared" clause.
    expect(vectorFile.vectors.length).toBeGreaterThan(0);
    fc.assert(
      fc.property(
        fc.constantFrom(...vectorFile.vectors),
        (vector) => {
          expect(canonicalKey(vector.analysis)).toBe(vector.canonicalKey);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
