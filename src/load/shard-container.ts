// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Reading a Container. A Shard_Content, little-endian:
//
// | Offset | Size | Field |
// |---|---|---|
// | 0 | 4 | magic `SHSF` (`53 48 53 46`) |
// | 4 | 2 | Format_Version, `u16` (1) |
// | 6 | 2 | part: `0` header, `1` stems, `u16` |
// | 8 | 4 | n, the Directory's length in bytes, padding included, `u32` |
// | 12 | n | the Directory: UTF-8 JSON, padded with spaces so that 12 + n is a multiple of 8 |
// | 12 + n | … | the Sections, in Directory order: the first at 12 + n, each later one at the next multiple of 8 after the one before, zero-padded between |
//
// The Directory is `{ "meta": Part_Meta, "sections": [{ "name", "type",
// "length", "offset", "byteLength", "filter" }] }`. The reader refuses a
// wrong magic, a Format_Version it does not read, a part other than the one
// expected, a Directory that is not JSON of that shape, a 12 + n that is not
// a multiple of 8, and a Section that is not where the layout puts it, runs
// past the end, or has a `byteLength` other than `length` times its element
// size; and bytes after the last Section. It undoes each Section's Filter
// into a fresh array, so nothing it returns holds the Shard_Content. It
// refuses a big-endian host, since the Sections are stored little-endian and
// never swapped, through a byte-order probe a test can replace.
//
// Errors are `AssetFormatError` without a `path`: the loader, which knows
// the Shard's file name, sets it.
//
// This is a new-design file: project header only.

import type { DecodedPart, Filter, SectionArray, SectionType } from '../engine/model-codec.js';

import { AssetFormatError } from './errors.js';
import { ELEMENT_SIZE, isFilter, undoFilter } from './section-filters.js';

/** The Format_Version this loader reads and the compiler writes. */
export const FORMAT_VERSION = 1;

/** The Container magic, `SHSF`. */
export const CONTAINER_MAGIC: readonly number[] = Object.freeze([0x53, 0x48, 0x53, 0x46]);

/** The fixed preamble's length: magic, Format_Version, part, Directory length. */
export const PREAMBLE_BYTES = 12;

/** A Container's part field: `0` header, `1` stems. */
export const PART_CODES = Object.freeze({ header: 0, stems: 1 } as const);

/** The part a Container holds. */
export type PartKind = keyof typeof PART_CODES;

/** One Section's Directory entry. */
export interface SectionEntry {
  name: string;
  type: SectionType;
  length: number;
  offset: number;
  byteLength: number;
  filter: Filter;
}

/** The next multiple of 8 at or after `n`. */
export function align8(n: number): number {
  return Math.ceil(n / 8) * 8;
}

/** Whether this host stores typed arrays little-endian. */
export function hostIsLittleEndian(): boolean {
  return new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
}

/** Whether `bytes` begin with the Container magic (no zlib stream does). */
export function isContainer(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && CONTAINER_MAGIC.every((b, i) => bytes[i] === b);
}

/** Options for {@link readContainer}. */
export interface ReadContainerOptions {
  /** The byte-order probe; replaced in tests. */
  littleEndian?: () => boolean;
}

const TYPES: ReadonlySet<string> = new Set<SectionType>(['u8', 'u16', 'u32', 'i32']);

function fail(message: string, section: string | null = null): never {
  throw new AssetFormatError(message, { section });
}

/**
 * The Part_Meta and Sections of the Container `bytes`, which must hold
 * `part`. Each Section is a fresh array with its Filter undone.
 *
 * @throws {AssetFormatError} for any departure from the layout, and on a
 *   big-endian host.
 */
export function readContainer(bytes: Uint8Array, part: PartKind, options: ReadContainerOptions = {}): DecodedPart {
  if (!(options.littleEndian ?? hostIsLittleEndian)()) {
    fail('this host is big-endian; Assets are read on little-endian hosts only');
  }
  if (bytes.length < PREAMBLE_BYTES || !isContainer(bytes)) {
    fail('not a Shard Container (no SHSF magic)');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  if (version !== FORMAT_VERSION) {
    fail(`the Container is Format_Version ${version}; this loader reads Format_Version ${FORMAT_VERSION}`);
  }
  const code = view.getUint16(6, true);
  if (code !== PART_CODES[part]) {
    fail(`the Container holds part ${code}, not the ${part} part (${PART_CODES[part]})`);
  }
  const n = view.getUint32(8, true);
  const base = PREAMBLE_BYTES + n;
  if (base % 8 !== 0) {
    fail(`the Directory ends at ${base}, which is not a multiple of 8`);
  }
  if (base > bytes.length) {
    fail(`the Directory runs past the end (${base} > ${bytes.length})`);
  }

  let directory: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(PREAMBLE_BYTES, base));
    directory = JSON.parse(text);
  } catch (e) {
    throw new AssetFormatError('the Directory is not UTF-8 JSON', {}, { cause: e });
  }
  if (typeof directory !== 'object' || directory === null || Array.isArray(directory)) {
    fail('the Directory is not a JSON object');
  }
  const { meta, sections } = directory as { meta?: unknown; sections?: unknown };
  if (meta === undefined) {
    fail('the Directory has no meta');
  }
  if (!Array.isArray(sections)) {
    fail('the Directory has no sections list');
  }

  const out = new Map<string, SectionArray>();
  let at = base;
  for (const [i, raw] of sections.entries()) {
    const entry = sectionEntry(raw, i);
    if (out.has(entry.name)) {
      fail(`the Section ${entry.name} is listed twice`, entry.name);
    }
    if (entry.offset !== at) {
      fail(
        entry.offset % 8 !== 0
          ? `the Section ${entry.name} is misaligned at ${entry.offset}`
          : entry.offset < at
            ? `the Section ${entry.name} at ${entry.offset} overlaps what comes before it (which ends at ${at})`
            : `the Section ${entry.name} is at ${entry.offset}, not at ${at}`,
        entry.name,
      );
    }
    if (entry.byteLength !== entry.length * ELEMENT_SIZE[entry.type]) {
      fail(`the Section ${entry.name} has byteLength ${entry.byteLength}, not ${entry.length} × ${ELEMENT_SIZE[entry.type]}`, entry.name);
    }
    const end = entry.offset + entry.byteLength;
    if (end > bytes.length) {
      fail(`the Section ${entry.name} runs past the end (${end} > ${bytes.length})`, entry.name);
    }
    out.set(entry.name, undoFilter(entry.filter, bytes.subarray(entry.offset, end), entry.type));
    at = align8(end);
    if (i === sections.length - 1) {
      at = end;
    }
  }
  if (at !== bytes.length) {
    fail(`${bytes.length - at} bytes follow the last Section`);
  }
  return { meta, sections: out };
}

/** One Directory entry, validated. */
function sectionEntry(raw: unknown, i: number): SectionEntry {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(`Directory entry ${i} is not an object`);
  }
  const e = raw as Record<string, unknown>;
  const name = e['name'];
  if (typeof name !== 'string' || name === '') {
    fail(`Directory entry ${i} has no name`);
  }
  const count = (key: string): number => {
    const v = e[key];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
      fail(`the Section ${name} has a ${key} that is not a non-negative safe integer`, name);
    }
    return v;
  };
  const type = e['type'];
  if (typeof type !== 'string' || !TYPES.has(type)) {
    fail(`the Section ${name} has the unknown type ${JSON.stringify(type)}`, name);
  }
  const filter = e['filter'];
  if (!isFilter(filter)) {
    fail(`the Section ${name} has the unknown filter ${JSON.stringify(filter)}`, name);
  }
  return {
    name,
    type: type as SectionType,
    length: count('length'),
    offset: count('offset'),
    byteLength: count('byteLength'),
    filter,
  };
}
