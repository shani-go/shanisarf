// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the LFU cache. They pin the semantics the analyzer relies on:
// eviction of the least-frequently-used entry, the tie-break among
// equally-used entries (the earliest to enter the lowest count's bucket), that
// a get or a re-set counts as a use, and that a capacity of 0 caches nothing.
// The lfu-cache-model property holds the cache to a naive model of the same
// rules over random operation sequences. Keys and values are invented.
import { describe, expect, it } from 'vitest';

import { LfuCache } from './lfu-cache.js';

describe('LfuCache construction', () => {
  it('rejects a negative or non-integer capacity', () => {
    expect(() => new LfuCache<number>(-1)).toThrow(RangeError);
    expect(() => new LfuCache<number>(1.5)).toThrow(RangeError);
    expect(() => new LfuCache<number>(Number.NaN)).toThrow(RangeError);
  });

  it('accepts a zero and a positive integer capacity', () => {
    expect(new LfuCache<number>(0).capacity).toBe(0);
    expect(new LfuCache<number>(5).capacity).toBe(5);
  });
});

describe('LfuCache basic get/set', () => {
  it('returns undefined on a miss and the stored value on a hit', () => {
    const cache = new LfuCache<string>(3);
    expect(cache.get('a')).toBeUndefined();
    cache.set('a', 'alpha');
    expect(cache.get('a')).toBe('alpha');
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('distinguishes a stored undefined value from a miss', () => {
    const cache = new LfuCache<number | undefined>(3);
    cache.set('a', undefined);
    expect(cache.has('a')).toBe(true);
    expect(cache.get('a')).toBeUndefined();
    // The get above was a hit, so the key is still present and used.
    expect(cache.has('a')).toBe(true);
  });

  it('re-setting a key updates its value without growing the size', () => {
    const cache = new LfuCache<string>(3);
    cache.set('a', 'first');
    cache.set('a', 'second');
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBe('second');
  });
});

describe('LfuCache capacity 0', () => {
  it('caches nothing: every set is a no-op and every get is a miss', () => {
    const cache = new LfuCache<number>(0);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(0);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('a')).toBeUndefined();
  });
});

describe('LfuCache eviction by frequency', () => {
  it('evicts the least-frequently-used entry when full', () => {
    const cache = new LfuCache<number>(2);
    cache.set('a', 1); // count 1
    cache.set('b', 2); // count 1
    // Use 'a' twice so 'b' is now the least-frequently-used.
    cache.get('a');
    cache.get('a');
    // Inserting 'c' overflows; 'b' (lowest count) is evicted.
    cache.set('c', 3);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.size).toBe(2);
  });

  it('a hit raises the use count so a colder entry is evicted', () => {
    const cache = new LfuCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // Warm a and c; b stays cold.
    cache.get('a');
    cache.get('c');
    cache.set('d', 4); // evicts b, the coldest
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('a re-set counts as a use for eviction purposes', () => {
    const cache = new LfuCache<number>(2);
    cache.set('a', 1); // count 1
    cache.set('b', 2); // count 1
    cache.set('a', 11); // re-set: 'a' now count 2
    cache.set('c', 3); // overflow: 'b' (count 1) evicted, not 'a'
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.get('a')).toBe(11);
    expect(cache.has('c')).toBe(true);
  });
});

describe('LfuCache tie-breaking by bucket entry', () => {
  it('evicts the oldest-inserted entry among entries never used since insertion', () => {
    const cache = new LfuCache<number>(3);
    cache.set('a', 1); // inserted first, count 1
    cache.set('b', 2); // inserted second, count 1
    cache.set('c', 3); // inserted third, count 1
    // All three share count 1; inserting 'd' evicts the oldest, 'a'.
    cache.set('d', 4);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('breaks a tie at the lowest count, not the overall oldest', () => {
    const cache = new LfuCache<number>(3);
    cache.set('a', 1); // oldest overall
    cache.set('b', 2);
    cache.set('c', 3);
    // Warm the oldest ('a') so b and c tie at the lowest count.
    cache.get('a');
    // Overflow: among the lowest-count entries {b, c}, evict the older, 'b'.
    cache.set('d', 4);
    expect(cache.has('a')).toBe(true); // kept: higher count
    expect(cache.has('b')).toBe(false); // evicted: older of the cold tie
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('among promoted entries, evicts the earliest to reach the lowest count, not the oldest inserted', () => {
    const cache = new LfuCache<number>(2);
    cache.set('a', 1); // inserted first
    cache.set('b', 2);
    cache.get('b'); // b enters the count-2 bucket first
    cache.get('a'); // a enters it second
    // Both at count 2: b entered that bucket earliest, so b goes, although a
    // is the older insertion.
    cache.set('c', 3);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
  });

  it('a re-set moves the key to the end of its new count bucket', () => {
    const cache = new LfuCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('b'); // count-2 bucket: b
    cache.set('a', 10); // count-2 bucket: b, a
    cache.get('c'); // count-2 bucket: b, a, c
    cache.set('d', 4); // no count-1 entry left: evict b, the head of count 2
    expect(cache.has('b')).toBe(false);
    expect([cache.has('a'), cache.has('c'), cache.has('d')]).toEqual([true, true, true]);
    cache.set('e', 5); // d (count 1) is now the lowest
    expect(cache.has('d')).toBe(false);
    expect(cache.get('a')).toBe(10);
  });

  it('keeps working after it empties and refills', () => {
    const cache = new LfuCache<number>(1);
    cache.set('a', 1);
    cache.get('a');
    cache.get('a');
    cache.set('b', 2); // evicts a (count 3), the only entry
    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBe(2);
    cache.clear();
    cache.set('c', 3);
    expect(cache.size).toBe(1);
    expect(cache.get('c')).toBe(3);
  });
});

describe('LfuCache clear', () => {
  it('removes every entry', () => {
    const cache = new LfuCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBeUndefined();
  });
});
