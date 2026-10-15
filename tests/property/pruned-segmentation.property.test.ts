// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Pruned segmentation is filtered segmentation. For any code-point array of
// length 0 to 12 (astral code points included), any `maxPrefix` and
// `maxSuffix` from 0 to 10, and any sets of prefix and suffix surfaces (the
// word's own plus strangers), `forEachHitSegment` visits exactly the triples
// `segments` yields whose prefix and suffix are in the sets, in `segments`
// order, with those surfaces' slots, and looks each distinct prefix and suffix
// up at most once. No database needed.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { forEachHitSegment, segments } from '../../src/engine/segments.js';

/** A small code-point pool: Arabic, Latin, and astral (surrogate-pair) code points. */
const codePoint = fc.constantFrom('ك', 'ت', 'ب', 'ا', 'ل', 'a', 'b', '\u{1F600}', '\u{10400}');

const caseArb = fc
  .record({
    cps: fc.array(codePoint, { maxLength: 12 }),
    maxPrefix: fc.integer({ min: 0, max: 10 }),
    maxSuffix: fc.integer({ min: 0, max: 10 }),
    prefixPick: fc.array(fc.boolean(), { minLength: 13, maxLength: 13 }),
    suffixPick: fc.array(fc.boolean(), { minLength: 13, maxLength: 13 }),
  })
  .map(({ cps, maxPrefix, maxSuffix, prefixPick, suffixPick }) => {
    const word = cps.join('');
    // The word's prefixes and suffixes by code point, each kept or not, plus a
    // surface that is never a prefix or suffix of it.
    const prefixes = new Set(['zz']);
    const suffixes = new Set(['zz']);
    for (let i = 0; i <= cps.length; i++) {
      if (prefixPick[i] === true) prefixes.add(cps.slice(0, i).join(''));
      if (suffixPick[i] === true) suffixes.add(cps.slice(i).join(''));
    }
    return { word, maxPrefix, maxSuffix, prefixes: [...prefixes], suffixes: [...suffixes] };
  });

describe('pruned segmentation is filtered segmentation', () => {
  it('visits exactly the filtered triples of segments, in order, with one lookup per surface', () => {
    fc.assert(
      fc.property(caseArb, ({ word, maxPrefix, maxSuffix, prefixes, suffixes }) => {
        const expected = [...segments(word, maxPrefix, maxSuffix)]
          .filter((t) => prefixes.includes(t.prefix) && suffixes.includes(t.suffix))
          .map((t) => [t.prefix, t.stem, t.suffix]);

        const prefixLookups = new Map<string, number>();
        const suffixLookups = new Map<string, number>();
        const visited: string[][] = [];
        forEachHitSegment(
          word,
          maxPrefix,
          maxSuffix,
          (prefix) => {
            prefixLookups.set(prefix, (prefixLookups.get(prefix) ?? 0) + 1);
            return prefixes.indexOf(prefix);
          },
          (suffix) => {
            suffixLookups.set(suffix, (suffixLookups.get(suffix) ?? 0) + 1);
            return suffixes.indexOf(suffix);
          },
          (prefixSlot, stem, suffixSlot) => {
            visited.push([prefixes[prefixSlot] as string, stem, suffixes[suffixSlot] as string]);
          },
        );

        expect(visited).toEqual(expected);
        expect([...prefixLookups.values()].every((count) => count === 1)).toBe(true);
        expect([...suffixLookups.values()].every((count) => count === 1)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
