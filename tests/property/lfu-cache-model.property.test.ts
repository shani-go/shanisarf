// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The O(1) LFU matches its model. A naive model keeps, per held key, its
// value, use count and the time it entered its current count's bucket;
// eviction takes the lowest count and, among those, the earliest entry. Over
// capacities 0–8 and up to 200 `get`/`set`/`has` operations on 12 keys, the
// cache and the model agree after every operation on its return value, `has`
// of every key, `size` and the held keys. Values include `undefined`, so a hit
// on a stored `undefined` is told from a miss. No database needed.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { LfuCache } from '../../src/engine/lfu-cache.js';

const KEYS = Array.from({ length: 12 }, (_, i) => `k${i}`);

type Op =
  | { op: 'get'; key: string }
  | { op: 'has'; key: string }
  | { op: 'set'; key: string; value: number | undefined };

/** The naive model of the eviction rule: linear scans, no buckets. */
class LfuModel {
  private readonly held = new Map<string, { value: number | undefined; count: number; entered: number }>();
  private clock = 0;

  constructor(private readonly capacity: number) {}

  get size(): number {
    return this.held.size;
  }

  /** The held keys, in `KEYS` order. */
  keys(): string[] {
    return KEYS.filter((k) => this.held.has(k));
  }

  has(key: string): boolean {
    return this.held.has(key);
  }

  get(key: string): number | undefined {
    const entry = this.held.get(key);
    if (entry === undefined) {
      return undefined;
    }
    entry.count++;
    entry.entered = this.clock++;
    return entry.value;
  }

  set(key: string, value: number | undefined): void {
    const entry = this.held.get(key);
    if (entry !== undefined) {
      entry.value = value;
      entry.count++;
      entry.entered = this.clock++;
      return;
    }
    if (this.capacity === 0) {
      return;
    }
    if (this.held.size >= this.capacity) {
      let victim: string | undefined;
      let best: { count: number; entered: number } | undefined;
      for (const [k, e] of this.held) {
        if (best === undefined || e.count < best.count || (e.count === best.count && e.entered < best.entered)) {
          victim = k;
          best = e;
        }
      }
      this.held.delete(victim as string);
    }
    this.held.set(key, { value, count: 1, entered: this.clock++ });
  }
}

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant('get' as const), key: fc.constantFrom(...KEYS) }),
  fc.record({ op: fc.constant('has' as const), key: fc.constantFrom(...KEYS) }),
  fc.record({
    op: fc.constant('set' as const),
    key: fc.constantFrom(...KEYS),
    value: fc.option(fc.integer({ min: 0, max: 999 }), { nil: undefined, freq: 8 }),
  }),
);

describe('the O(1) LFU matches its model', () => {
  it('agrees with the naive model after every operation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8 }),
        fc.array(opArb, { maxLength: 200, size: 'max' }),
        (capacity, ops) => {
          const cache = new LfuCache<number | undefined>(capacity);
          const model = new LfuModel(capacity);
          ops.forEach((op, i) => {
            const at = `op ${i} ${JSON.stringify(op)}`;
            if (op.op === 'get') {
              expect(cache.get(op.key), at).toBe(model.get(op.key));
            } else if (op.op === 'has') {
              expect(cache.has(op.key), at).toBe(model.has(op.key));
            } else {
              cache.set(op.key, op.value);
              model.set(op.key, op.value);
            }
            expect(cache.size, at).toBe(model.size);
            expect(KEYS.filter((k) => cache.has(k)), at).toEqual(model.keys());
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});
