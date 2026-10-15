// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The Container reads what the writer wrote, and nothing else. For any list
// of 0 to 12 named Sections of random types, lengths and Filters, and any
// JSON-safe Part_Meta, `readContainer(writeContainer(…))` gives the same
// Part_Meta and Sections in order, and writing twice gives the same bytes.
// Every Section offset is a multiple of 8, the first at 12 + n. Changing the
// magic, the Format_Version or the part, or moving a Section's offset so that
// it overlaps, misaligns or runs past the end, throws `AssetFormatError`; a
// big-endian probe is refused too.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { writeContainer } from '../../src/compile/shard-writer.js';
import type { EncodedSection, Filter, SectionArray, SectionType } from '../../src/engine/model-codec.js';
import { AssetFormatError } from '../../src/load/errors.js';
import { PREAMBLE_BYTES, type PartKind, readContainer } from '../../src/load/shard-container.js';

const TYPES: readonly SectionType[] = ['u8', 'u16', 'u32', 'i32'];
const FILTERS: readonly Filter[] = ['none', 'shuffle', 'delta-shuffle'];

const make = (type: SectionType, values: readonly number[]): SectionArray =>
  type === 'u8'
    ? Uint8Array.from(values)
    : type === 'u16'
      ? Uint16Array.from(values)
      : type === 'u32'
        ? Uint32Array.from(values)
        : Int32Array.from(values);

const section = (name: string): fc.Arbitrary<EncodedSection> =>
  fc
    .record({
      type: fc.constantFrom(...TYPES),
      filter: fc.constantFrom(...FILTERS),
      values: fc.array(fc.integer({ min: -0x80000000, max: 0xffffffff }), { maxLength: 40 }),
    })
    .map(({ type, filter, values }) => [name, make(type, values), filter] as const);

const container = fc.record({
  part: fc.constantFrom<PartKind>('header', 'stems'),
  meta: fc.jsonValue({ maxDepth: 3 }),
  sections: fc
    .uniqueArray(fc.stringMatching(/^[a-z][a-zA-Z.]{0,11}$/u), { maxLength: 12 })
    .chain((names) => (names.length === 0 ? fc.constant([]) : fc.tuple(...names.map(section)))),
});

/** The Directory of `bytes`, and its length n. */
function directoryOf(bytes: Uint8Array): { n: number; dir: { meta: unknown; sections: { offset: number; byteLength: number }[] } } {
  const n = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true);
  const text = new TextDecoder().decode(bytes.subarray(PREAMBLE_BYTES, PREAMBLE_BYTES + n));
  return { n, dir: JSON.parse(text) };
}

/** `bytes` with its Directory replaced by `dir`, padded to the same n; null when it no longer fits. */
function withDirectory(bytes: Uint8Array, n: number, dir: unknown): Uint8Array | null {
  const json = new TextEncoder().encode(JSON.stringify(dir));
  if (json.length > n) {
    return null;
  }
  const out = bytes.slice();
  out.fill(0x20, PREAMBLE_BYTES, PREAMBLE_BYTES + n);
  out.set(json, PREAMBLE_BYTES);
  return out;
}

function refused(bytes: Uint8Array, part: PartKind): boolean {
  try {
    readContainer(bytes, part);
    return false;
  } catch (e) {
    return e instanceof AssetFormatError;
  }
}

describe('the Container reads what the writer wrote, and nothing else', () => {
  it('round-trips, aligns every Section, and refuses a changed preamble or a moved Section', () => {
    fc.assert(
      fc.property(container, fc.nat(), fc.integer({ min: 1, max: 7 }), ({ part, meta, sections }, pick, shift) => {
        const bytes = writeContainer(part, meta, sections);
        expect(writeContainer(part, meta, sections)).toEqual(bytes);

        const back = readContainer(bytes, part);
        expect(back.meta).toEqual(JSON.parse(JSON.stringify(meta)));
        expect([...back.sections.keys()]).toEqual(sections.map(([name]) => name));
        for (const [name, array] of sections) {
          const got = back.sections.get(name) as SectionArray;
          expect(got.constructor).toBe(array.constructor);
          expect(Array.from(got)).toEqual(Array.from(array));
          expect(got.buffer).not.toBe(bytes.buffer);
        }

        const { n, dir } = directoryOf(bytes);
        expect((PREAMBLE_BYTES + n) % 8).toBe(0);
        dir.sections.forEach((s, i) => {
          expect(s.offset % 8).toBe(0);
          if (i === 0) expect(s.offset).toBe(PREAMBLE_BYTES + n);
        });

        // The preamble.
        const magic = bytes.slice();
        magic[pick % 4] = (magic[pick % 4] as number) ^ (1 + (pick % 255));
        expect(refused(magic, part)).toBe(true);
        const version = bytes.slice();
        new DataView(version.buffer).setUint16(4, 2 + (pick % 1000), true);
        expect(refused(version, part)).toBe(true);
        expect(refused(bytes, part === 'header' ? 'stems' : 'header')).toBe(true);

        // A moved Section: misaligned, overlapping what comes before, or past the end.
        if (dir.sections.length > 0) {
          const i = pick % dir.sections.length;
          const moves: ((s: { offset: number; byteLength: number }) => void)[] = [
            (s) => (s.offset += shift),
            (s) => (s.offset -= 8),
            (s) => (s.offset = bytes.length + 8 * shift),
          ];
          for (const move of moves) {
            const changed = structuredClone(dir);
            move(changed.sections[i] as { offset: number; byteLength: number });
            const corrupt = withDirectory(bytes, n, changed);
            if (corrupt !== null) {
              expect(refused(corrupt, part)).toBe(true);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('refuses a big-endian host, with no path', () => {
    const bytes = writeContainer('header', {}, []);
    expect(() => readContainer(bytes, 'header', { littleEndian: () => false })).toThrow(AssetFormatError);
    try {
      readContainer(bytes, 'header', { littleEndian: () => false });
    } catch (e) {
      expect((e as AssetFormatError).path).toBeNull();
      expect((e as AssetFormatError).message).toContain('big-endian');
    }
  });
});
