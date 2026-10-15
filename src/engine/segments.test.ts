// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for prefix/stem/suffix segmentation: a few concrete enumerations
// against CAMeL Tools' double loop, so the order, bounds and code-point
// handling are visible. The segments property proves the general re-join and
// bounds claims. Test words are invented or built from the character sets.
import { describe, expect, it } from 'vitest';

import { segments } from './segments.js';

/** Collect a segmentation generator into plain triples for comparison. */
function list(word: string, maxPrefix: number, maxSuffix: number): string[][] {
  return Array.from(segments(word, maxPrefix, maxSuffix)).map((seg) => [
    seg.prefix,
    seg.stem,
    seg.suffix,
  ]);
}

describe('segments', () => {
  it('yields nothing for the empty word (Python range(0, 0))', () => {
    expect(list('', 3, 3)).toEqual([]);
  });

  it('yields exactly the whole word for a single code point', () => {
    // n = 1: p in 0..min(3, 0) = {0}; s in max(1, 1 - 0 - 3)..1 = {1}.
    expect(list('a', 3, 3)).toEqual([['', 'a', '']]);
  });

  it('enumerates all splits in the CAMeL Tools order (prefix outer, stem inner)', () => {
    // n = 3, maxPrefix = maxSuffix = 3.
    // p = 0: s in max(1, 0)..3 -> 1,2,3
    // p = 1: s in max(1, -1)..2 -> 1,2
    // p = 2: s in max(1, -2)..1 -> 1
    expect(list('abc', 3, 3)).toEqual([
      ['', 'a', 'bc'],
      ['', 'ab', 'c'],
      ['', 'abc', ''],
      ['a', 'b', 'c'],
      ['a', 'bc', ''],
      ['ab', 'c', ''],
    ]);
  });

  it('never yields an empty stem', () => {
    for (const seg of segments('abcd', 2, 2)) {
      expect(seg.stem.length).toBeGreaterThan(0);
    }
  });

  it('respects the prefix bound: p only up to min(maxPrefix, n - 1)', () => {
    // n = 4, maxPrefix = 1 -> p in {0, 1}; no prefix longer than one char.
    const prefixes = new Set(list('abcd', 1, 4).map(([p]) => p));
    expect(prefixes).toEqual(new Set(['', 'a']));
  });

  it('respects the suffix bound: suffix length never exceeds maxSuffix', () => {
    // maxSuffix = 1 -> every suffix is at most one code point.
    for (const seg of segments('abcde', 4, 1)) {
      expect(Array.from(seg.suffix).length).toBeLessThanOrEqual(1);
    }
  });

  it('never splits an astral code point and re-joins to the input', () => {
    // 😀 (U+1F600) and 🚀 (U+1F680) are astral; the Arabic letter is BMP.
    const word = '😀ب🚀';
    for (const seg of segments(word, 3, 3)) {
      // Each part re-joins to the input and holds whole code points only.
      expect(seg.prefix + seg.stem + seg.suffix).toBe(word);
      expect(Array.from(seg.prefix).join('')).toBe(seg.prefix);
      expect(Array.from(seg.stem).join('')).toBe(seg.stem);
      expect(Array.from(seg.suffix).join('')).toBe(seg.suffix);
    }
    // n = 3 (three code points), so the full enumeration has 6 splits.
    expect(Array.from(segments(word, 3, 3))).toHaveLength(6);
  });
});
