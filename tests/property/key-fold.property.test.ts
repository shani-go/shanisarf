// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The Fold is one function, and folded lookups are its unions. Over the
// Arabic word arbitraries, `foldArabicKey` is idempotent; its output holds no
// diacritic, tatweel, alef variant, alef maksura or teh marbuta; and a string
// with none of those comes back as itself (`===`). Over `lexiconDoc` parsed
// under `a` and `r`, for every key the text holds, its folded form, a marked
// form and a few absent keys: `lookup(by, key, { fold: true })` equals the
// union, in line order and each entry once, of `lookup(by, k)` over the index
// keys `k` with the same fold; and `lookup(by, key)` is a subsequence of it.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseAlmor } from '../../src/engine/almor-parser.js';
import { AR_DIAC_CHARSET, AR_LETTERS_CHARSET } from '../../src/engine/charsets.js';
import { foldArabicKey } from '../../src/engine/key-fold.js';
import { Lexicon } from '../../src/engine/lexicon.js';

import { arAr, arNormVariant } from './arbitraries';
import { keyOf, lexiconDoc, LOOKUP_KEYS, plainOf } from './lexicon-support';

const TATWEEL = 'ـ';
/** The letters the Fold rewrites: four alef variants, alef maksura, teh marbuta. */
const FOLDED_LETTERS = ['آ', 'أ', 'إ', 'ٱ', 'ى', 'ة'];
const FOLDED = new Set<string>([...AR_DIAC_CHARSET, TATWEEL, ...FOLDED_LETTERS]);

/** A word over every Arabic letter (the tatweel among them) with any diacritics after each. */
const arAny: fc.Arbitrary<string> = fc
  .array(
    fc.tuple(
      fc.constantFrom(...AR_LETTERS_CHARSET),
      fc.array(fc.constantFrom(...AR_DIAC_CHARSET), { maxLength: 2 }),
    ),
    { minLength: 0, maxLength: 6 },
  )
  .map((units) => units.map(([letter, marks]) => letter + marks.join('')).join(''));

const arWord: fc.Arbitrary<string> = fc.oneof(arAr, arNormVariant, arAny);

const ABSENT_KEYS = ['', 'zz', 'غغ'];

/** Whether `small` is a subsequence of `big`, comparing by JSON. */
function isSubsequence(small: readonly unknown[], big: readonly unknown[]): boolean {
  let i = 0;
  for (const item of big) {
    if (i < small.length && JSON.stringify(item) === JSON.stringify(small[i])) i++;
  }
  return i === small.length;
}

describe('the Fold is one function, and folded lookups are its unions', () => {
  it('is idempotent, leaves no folded code point, and is the identity on a string without one', { timeout: 60_000 }, () => {
    fc.assert(
      fc.property(arWord, (s) => {
        const folded = foldArabicKey(s);
        expect(foldArabicKey(folded)).toBe(folded);
        for (const cp of folded) {
          expect(FOLDED.has(cp), `U+${cp.codePointAt(0)!.toString(16)} in ${JSON.stringify(folded)}`).toBe(false);
        }
        const plain = [...s].filter((cp) => !FOLDED.has(cp)).join('');
        expect(foldArabicKey(plain)).toBe(plain);
      }),
      { numRuns: 200 },
    );
  });

  it('a folded lookup is the line-ordered union of the exact lookups that fold equal, and holds the exact one', { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(lexiconDoc, fc.constantFrom('َ', 'ّ', TATWEEL), (text, mark) => {
        for (const flags of ['a', 'r'] as const) {
          const lexicon = new Lexicon(parseAlmor(text, { flags }));
          const lines = [...lexicon.entries()];
          for (const by of LOOKUP_KEYS) {
            const indexKeys = new Set<string>();
            for (const line of lines) {
              const k = keyOf(by, line);
              if (k !== undefined) indexKeys.add(k);
            }
            const probes = new Set<string>(ABSENT_KEYS);
            for (const k of indexKeys) {
              probes.add(k);
              probes.add(foldArabicKey(k));
              const cps = [...k];
              probes.add(`${cps[0] ?? ''}${mark}${cps.slice(1).join('')}`);
            }
            for (const key of probes) {
              const label = `${flags} ${by} ${JSON.stringify(key)}`;
              const target = foldArabicKey(key);
              const matching = [...indexKeys].filter((k) => foldArabicKey(k) === target);
              const exact = new Map(matching.map((k) => [k, lexicon.lookup(by, k).map(plainOf)]));
              // The union in line order: each line once, taken when its key is one of `matching`.
              const union = lines.filter((l) => exact.has(keyOf(by, l) as string)).map(plainOf);
              // And it is exactly the exact lookups' records, as a multiset.
              expect(union.length, label).toBe([...exact.values()].reduce((n, rs) => n + rs.length, 0));
              const folded = lexicon.lookup(by, key, { fold: true }).map(plainOf);
              expect(folded, label).toEqual(union);
              expect(isSubsequence(lexicon.lookup(by, key).map(plainOf), folded), `${label} exact ⊑ folded`).toBe(true);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
