// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The Section Filters. The tuple model's arrays are mostly small integers in
// wide words, and offsets that rise slowly; deflate does poorly on both as
// stored. Two reversible transforms fix that:
//
// - `shuffle` writes the bytes of a k-byte array as k planes: every
//   element's byte 0, then every element's byte 1, and so on. The high
//   bytes, mostly zero, then form long runs.
// - `delta-shuffle` first replaces each element after the first with its
//   difference from the one before, in the element's own width with
//   wraparound, so it is exact for every value; then shuffles.
// - `none` leaves the bytes as they are (byte arrays, the UTF-8 text).
//
// Applying and undoing each write a new array, so a Section read from a
// Container never shares the Shard_Content's buffer, which can then be
// collected. The byte planes are the host's byte order, which the Container
// reader requires to be little-endian.
//
// This is a new-design file: project header only.

import type { Filter, SectionArray, SectionType } from '../engine/model-codec.js';

/** Bytes per element of each Section type. */
export const ELEMENT_SIZE: Readonly<Record<SectionType, number>> = Object.freeze({ u8: 1, u16: 2, u32: 4, i32: 4 });

const FILTERS: ReadonlySet<string> = new Set<Filter>(['none', 'shuffle', 'delta-shuffle']);

/** Whether `value` names a Filter. */
export function isFilter(value: unknown): value is Filter {
  return typeof value === 'string' && FILTERS.has(value);
}

/** A new, zeroed array of `type` and `length` elements. */
export function newSection(type: SectionType, length: number): SectionArray {
  switch (type) {
    case 'u8':
      return new Uint8Array(length);
    case 'u16':
      return new Uint16Array(length);
    case 'u32':
      return new Uint32Array(length);
    case 'i32':
      return new Int32Array(length);
  }
}

function typeOf(array: SectionArray): SectionType {
  if (array instanceof Uint8Array) return 'u8';
  if (array instanceof Uint16Array) return 'u16';
  if (array instanceof Uint32Array) return 'u32';
  return 'i32';
}

/** `array`'s bytes as byte planes: plane b holds byte b of every element, in order. */
export function shuffle(array: SectionArray): Uint8Array {
  const n = array.length;
  const k = array.BYTES_PER_ELEMENT;
  const bytes = new Uint8Array(array.buffer, array.byteOffset, n * k);
  const out = new Uint8Array(n * k);
  if (k === 1) {
    out.set(bytes);
    return out;
  }
  if (k === 2) {
    const a = array as Uint16Array;
    for (let i = 0; i < n; i++) {
      const v = a[i] as number;
      out[i] = v & 0xff;
      out[n + i] = v >>> 8;
    }
    return out;
  }
  const a = array as Uint32Array | Int32Array;
  for (let i = 0; i < n; i++) {
    const v = a[i] as number;
    out[i] = v & 0xff;
    out[n + i] = (v >>> 8) & 0xff;
    out[2 * n + i] = (v >>> 16) & 0xff;
    out[3 * n + i] = v >>> 24;
  }
  return out;
}

/** The array of `type` whose byte planes are `planes` (a new array). */
export function unshuffle(planes: Uint8Array, type: SectionType): SectionArray {
  const k = ELEMENT_SIZE[type];
  if (planes.length % k !== 0) {
    throw new RangeError(`unshuffle: ${planes.length} bytes is not a whole number of ${type} elements`);
  }
  const n = planes.length / k;
  const out = newSection(type, n);
  if (k === 1) {
    (out as Uint8Array).set(planes);
    return out;
  }
  if (k === 2) {
    const o = out as Uint16Array;
    for (let i = 0; i < n; i++) {
      o[i] = (planes[i] as number) | ((planes[n + i] as number) << 8);
    }
    return out;
  }
  const o = out as Uint32Array | Int32Array;
  for (let i = 0; i < n; i++) {
    o[i] =
      (planes[i] as number) |
      ((planes[n + i] as number) << 8) |
      ((planes[2 * n + i] as number) << 16) |
      ((planes[3 * n + i] as number) << 24);
  }
  return out;
}

/** Each element after the first replaced by its difference from the one before, wrapping in its width (a new array). */
export function delta<T extends SectionArray>(array: T): T {
  const out = newSection(typeOf(array), array.length) as T;
  if (array.length > 0) {
    out[0] = array[0] as number;
  }
  for (let i = 1; i < array.length; i++) {
    // A typed array store wraps modulo 2^width, so the difference is exact.
    out[i] = (array[i] as number) - (array[i - 1] as number);
  }
  return out;
}

/** The inverse of {@link delta} (a new array). */
export function undelta<T extends SectionArray>(array: T): T {
  const out = newSection(typeOf(array), array.length) as T;
  out.set(array as never);
  undeltaInPlace(out);
  return out;
}

/** {@link undelta} over `array` itself. */
function undeltaInPlace(array: SectionArray): void {
  for (let i = 1; i < array.length; i++) {
    array[i] = (array[i] as number) + (array[i - 1] as number);
  }
}

/** The bytes a Section is stored as under `filter`. */
export function applyFilter(filter: Filter, array: SectionArray): Uint8Array {
  switch (filter) {
    case 'none': {
      const out = new Uint8Array(array.byteLength);
      out.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      return out;
    }
    case 'shuffle':
      return shuffle(array);
    case 'delta-shuffle':
      return shuffle(delta(array));
  }
}

/**
 * The Section of `type` stored as `bytes` under `filter`: a new array that
 * shares nothing with `bytes`.
 */
export function undoFilter(filter: Filter, bytes: Uint8Array, type: SectionType): SectionArray {
  switch (filter) {
    case 'none': {
      const k = ELEMENT_SIZE[type];
      if (bytes.length % k !== 0) {
        throw new RangeError(`undoFilter: ${bytes.length} bytes is not a whole number of ${type} elements`);
      }
      const out = newSection(type, bytes.length / k);
      new Uint8Array(out.buffer).set(bytes);
      return out;
    }
    case 'shuffle':
      return unshuffle(bytes, type);
    case 'delta-shuffle': {
      const out = unshuffle(bytes, type);
      undeltaInPlace(out);
      return out;
    }
  }
}
