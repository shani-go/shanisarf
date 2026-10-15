// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Writing a Container. The layout is the one `src/load/shard-container.ts`
// reads: the preamble (`SHSF`, the Format_Version, the part, the Directory's
// length n), the Directory as JSON padded with spaces so that 12 + n is a
// multiple of 8, then each Section through the Filter it is given, the first
// at 12 + n and each later one at the next multiple of 8, zero-padded
// between.
//
// The writer is deterministic: the Directory's key order is fixed, its
// numbers are integers in JSON's one form, and the Part_Meta is serialized
// in the key order it was built in. The same Part_Meta and Sections give the
// same bytes.
//
// This is a new-design file: project header only.

import type { EncodedSection, SectionArray } from '../engine/model-codec.js';
import { sectionType } from '../engine/model-codec.js';
import { applyFilter } from '../load/section-filters.js';
import {
  align8,
  CONTAINER_MAGIC,
  FORMAT_VERSION,
  PART_CODES,
  type PartKind,
  PREAMBLE_BYTES,
  type SectionEntry,
} from '../load/shard-container.js';

/**
 * The Container of `part` holding `meta` (JSON-safe) and `sections`, in
 * order, each written through its Filter.
 */
export function writeContainer(part: PartKind, meta: unknown, sections: readonly EncodedSection[]): Uint8Array {
  const stored = sections.map(([, array, filter]) => applyFilter(filter, array));
  const encoder = new TextEncoder();

  // The Directory names the offsets, which follow it, so its length is found
  // by iteration: start from the Directory with the smallest offsets, and
  // grow n until the text fits.
  let n = 0;
  let json: Uint8Array;
  for (;;) {
    const entries = layout(sections, PREAMBLE_BYTES + n);
    json = encoder.encode(JSON.stringify({ meta, sections: entries }));
    if (json.length <= n) {
      break;
    }
    n = align8(PREAMBLE_BYTES + json.length) - PREAMBLE_BYTES;
  }
  const entries = layout(sections, PREAMBLE_BYTES + n);
  const last = entries[entries.length - 1];
  const total = last === undefined ? PREAMBLE_BYTES + n : last.offset + last.byteLength;

  const out = new Uint8Array(total);
  out.set(CONTAINER_MAGIC, 0);
  const view = new DataView(out.buffer);
  view.setUint16(4, FORMAT_VERSION, true);
  view.setUint16(6, PART_CODES[part], true);
  view.setUint32(8, n, true);
  out.set(json, PREAMBLE_BYTES);
  out.fill(0x20, PREAMBLE_BYTES + json.length, PREAMBLE_BYTES + n);
  entries.forEach((entry, i) => out.set(stored[i] as Uint8Array, entry.offset));
  return out;
}

/** The Directory entries of `sections` laid out from `base`, which must be a multiple of 8. */
function layout(sections: readonly EncodedSection[], base: number): SectionEntry[] {
  let at = base;
  return sections.map(([name, array, filter]) => {
    const entry: SectionEntry = {
      name,
      type: sectionType(array as SectionArray),
      length: array.length,
      offset: align8(at),
      byteLength: array.byteLength,
      filter,
    };
    at = entry.offset + entry.byteLength;
    return entry;
  });
}
