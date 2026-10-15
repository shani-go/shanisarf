// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Filters invert. For any typed array of type u8, u16, u32 or i32 and length
// 0 to 300 (values from the full range, small values, and non-decreasing
// sequences), undoing each Filter after applying it gives the same values in a
// new array of the same type. A shuffled array's byte plane b holds exactly
// byte b of every element, in order; `delta` keeps the first element and
// wraps in the element's width.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Filter, SectionArray, SectionType } from '../../src/engine/model-codec.js';
import { applyFilter, delta, ELEMENT_SIZE, shuffle, undelta, undoFilter } from '../../src/load/section-filters.js';

const TYPES: readonly SectionType[] = ['u8', 'u16', 'u32', 'i32'];
const FILTERS: readonly Filter[] = ['none', 'shuffle', 'delta-shuffle'];

const RANGE: Record<SectionType, [number, number]> = {
  u8: [0, 0xff],
  u16: [0, 0xffff],
  u32: [0, 0xffffffff],
  i32: [-0x80000000, 0x7fffffff],
};

function make(type: SectionType, values: readonly number[]): SectionArray {
  switch (type) {
    case 'u8':
      return Uint8Array.from(values);
    case 'u16':
      return Uint16Array.from(values);
    case 'u32':
      return Uint32Array.from(values);
    case 'i32':
      return Int32Array.from(values);
  }
}

/** Values of `type`: the full range, small values, or a non-decreasing run. */
const valuesOf = (type: SectionType): fc.Arbitrary<number[]> => {
  const [min, max] = RANGE[type];
  const full = fc.array(fc.integer({ min, max }), { maxLength: 300 });
  const small = fc.array(fc.integer({ min: Math.max(min, -3), max: 300 }), { maxLength: 300 });
  const rising = fc
    .array(fc.integer({ min: 0, max: 1000 }), { maxLength: 300 })
    .map((steps) => {
      let at = min < 0 ? -100_000 : 0;
      return steps.map((s) => (at = Math.min(max, at + s)));
    });
  return fc.oneof(full, small, rising);
};

const arrays = fc
  .constantFrom(...TYPES)
  .chain((type) => valuesOf(type).map((values) => ({ type, array: make(type, values) })));

describe('Filters invert', () => {
  it('undoing each Filter gives the same values in a new array, and shuffle writes byte planes', () => {
    fc.assert(
      fc.property(arrays, ({ type, array }) => {
        const k = ELEMENT_SIZE[type];
        for (const filter of FILTERS) {
          const stored = applyFilter(filter, array);
          expect(stored.length).toBe(array.length * k);
          const back = undoFilter(filter, stored, type);
          expect(back.constructor).toBe(array.constructor);
          expect(back.buffer).not.toBe(array.buffer);
          expect(back.buffer).not.toBe(stored.buffer);
          expect(Array.from(back), `${type} ${filter}`).toEqual(Array.from(array));
        }

        const planes = shuffle(array);
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        for (let b = 0; b < k; b++) {
          for (let i = 0; i < array.length; i++) {
            expect(planes[b * array.length + i]).toBe(bytes[i * k + b]);
          }
        }

        const d = delta(array);
        expect(d.constructor).toBe(array.constructor);
        if (array.length > 0) {
          expect(d[0]).toBe(array[0]);
        }
        expect(Array.from(undelta(d))).toEqual(Array.from(array));
      }),
      { numRuns: 200 },
    );
  });
});
