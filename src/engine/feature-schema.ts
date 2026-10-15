// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Feature_Names, Layouts, entry tables and key indexes. The tuple model stores
// each prefix, suffix and stem line as a category id, a Layout id and a Tuple
// of value string ids, in typed arrays, in line order.
//
// - The Feature_Name list, one per model: the `defines` keys in `DEFINES`
//   order, then every entry key not defined, in first-seen order, then each
//   name a merge step or a path can add that is not yet listed. A Feature_Id
//   is an index in it. Its order never shows in any output.
// - A Layout is one line's keys by first occurrence; the line's Tuple holds,
//   per Layout position, the value of the key's last occurrence. That is what
//   a plain object does with `res[key] = value` over a line that repeats a
//   key. Layouts are interned per model.
// - An entry table holds a section's lines in line order: the entry id is the
//   line's index within its section. Affix tables also carry a dense row per
//   entry, one slot per Feature_Id, holding a value string id or -1, so the
//   merge reads an affix value for any key at once.
// - Key indexes are compressed sparse rows: a slot's entry ids, in line
//   order, are `ids[start[slot] .. start[slot + 1])`. A KeyIndex finds the
//   slot from a string (surface, lemma); an IdIndex's slot is a dense id
//   (a category id).
//
// Every array's width is chosen at build from the counts, so a database with
// more than 65,535 categories, Layouts or Feature_Names still builds.
// Log-probabilities stay string ids: the merge converts them.
//
// This is a new-design file: project header only, in the ported-code check's
// exclusions.

import {
  CONCAT_FEATS,
  CONCAT_FEATS_NONE,
  JOIN_FEATS,
  LOGPROB_FEATS,
  TOK_SCHEMES_1,
  TOK_SCHEMES_2,
} from './features.js';

/** An array of non-negative ids, 16-bit when every id fits. */
export type IdArray = Uint16Array | Uint32Array;

/** `values` as a {@link IdArray}: 16-bit when `max` fits, 32-bit otherwise. */
export function idArray(values: ArrayLike<number>, max: number): IdArray {
  return max <= 0xffff ? Uint16Array.from(values) : Uint32Array.from(values);
}

/**
 * The names a merge step or a path can add to a result, appended to the
 * Feature_Name list after the defined and the parsed keys.
 */
export const MERGE_FEATURE_NAMES: readonly string[] = [
  'stem',
  'stemgloss',
  'stemcat',
  'source',
  ...JOIN_FEATS,
  ...CONCAT_FEATS,
  ...CONCAT_FEATS_NONE,
  ...TOK_SCHEMES_1,
  ...TOK_SCHEMES_2,
  ...LOGPROB_FEATS,
];

/** A model's Feature_Name list and its Layouts. */
export interface FeatureSchema {
  /** Feature_Id → name. */
  readonly names: readonly string[];
  /** Name → Feature_Id. */
  readonly ids: ReadonlyMap<string, number>;
  /** Layout id → its Feature_Ids, in the order the line first stated them. */
  readonly layouts: readonly IdArray[];
}

/** A section's entries in line order. */
export interface EntryTable {
  readonly count: number;
  /** Entry id → its role-local category id. */
  readonly category: IdArray;
  /** Entry id → Layout id. */
  readonly layout: IdArray;
  /** `count + 1` offsets into `values`. */
  readonly valueStart: Uint32Array;
  /** The Tuples: value string ids, aligned with each entry's Layout. */
  readonly values: Uint32Array;
  /** Affix tables only: `count × F` value string ids by Feature_Id, -1 for absent. */
  readonly dense: Int32Array | null;
}

/** A string-keyed index: slot `s`'s entries are `ids[start[s] .. start[s + 1])`. */
export interface KeyIndex {
  /** Key → slot, in first-seen order (a slot is its insertion index). */
  readonly slots: ReadonlyMap<string, number>;
  readonly start: Uint32Array;
  readonly ids: Uint32Array;
}

/** A dense-id index: slot `s` (a category id) holds `ids[start[s] .. start[s + 1])`. */
export interface IdIndex {
  readonly start: Uint32Array;
  readonly ids: Uint32Array;
}

/** Builds a {@link FeatureSchema}: Feature_Ids and interned Layouts. */
export class FeatureSchemaBuilder {
  readonly names: string[] = [];
  readonly ids = new Map<string, number>();
  private readonly layouts: number[][] = [];
  private readonly layoutIds = new Map<string, number>();
  private lastLayout: number[] | null = null;
  private lastLayoutId = -1;

  /** The Feature_Id of `name`, assigning the next one on first sight. */
  featureId(name: string): number {
    let id = this.ids.get(name);
    if (id === undefined) {
      id = this.names.length;
      this.names.push(name);
      this.ids.set(name, id);
    }
    return id;
  }

  /**
   * The Layout id of the key sequence `keys`, interning it on first sight.
   * Consecutive lines usually share a Layout, so the last one is checked
   * first.
   */
  layoutId(keys: readonly number[]): number {
    const last = this.lastLayout;
    if (last !== null && last.length === keys.length) {
      let same = true;
      for (let i = 0; i < keys.length; i++) {
        if (last[i] !== keys[i]) {
          same = false;
          break;
        }
      }
      if (same) {
        return this.lastLayoutId;
      }
    }
    const text = keys.join(',');
    let id = this.layoutIds.get(text);
    if (id === undefined) {
      id = this.layouts.length;
      this.layouts.push(keys.slice());
      this.layoutIds.set(text, id);
    }
    this.lastLayout = this.layouts[id] as number[];
    this.lastLayoutId = id;
    return id;
  }

  /** The number of Layouts interned so far. */
  get layoutCount(): number {
    return this.layouts.length;
  }

  /** Append the merge-step names not yet listed, and freeze the schema. */
  finish(): FeatureSchema {
    for (const name of MERGE_FEATURE_NAMES) {
      this.featureId(name);
    }
    const max = this.names.length - 1;
    return {
      names: this.names,
      ids: this.ids,
      layouts: this.layouts.map((keys) => idArray(keys, max)),
    };
  }
}

/**
 * Builds one section's {@link EntryTable}, a line at a time: `begin()`, one
 * `token()` per feature token in line order, then `end()`.
 */
export class EntryTableBuilder {
  private readonly schema: FeatureSchemaBuilder;
  private readonly categories: number[] = [];
  private readonly layouts: number[] = [];
  private readonly starts: number[] = [0];
  private values = new Uint32Array(1 << 12);
  private valueCount = 0;

  // The open line: its keys by first occurrence and each key's last value.
  // `stampOf[f] === stamp` marks Feature_Id `f` as seen on the open line, at
  // position `posOf[f]`.
  private readonly keys: number[] = [];
  private readonly vals: number[] = [];
  private posOf = new Int32Array(64);
  private stampOf = new Uint32Array(64);
  private stamp = 0;

  constructor(schema: FeatureSchemaBuilder) {
    this.schema = schema;
  }

  /** The number of entries ended so far. */
  get count(): number {
    return this.categories.length;
  }

  /** Open a line. */
  begin(): void {
    this.stamp++;
    this.keys.length = 0;
    this.vals.length = 0;
  }

  /**
   * One feature token of the open line: a repeated key keeps its first
   * position and takes this value.
   */
  token(featureId: number, valueId: number): void {
    if (featureId >= this.stampOf.length) {
      this.growScratch(featureId);
    }
    if (this.stampOf[featureId] === this.stamp) {
      this.vals[this.posOf[featureId] as number] = valueId;
      return;
    }
    this.stampOf[featureId] = this.stamp;
    this.posOf[featureId] = this.keys.length;
    this.keys.push(featureId);
    this.vals.push(valueId);
  }

  /** The open line's value for `featureId`, or -1 when it has none. */
  valueOf(featureId: number): number {
    return featureId < this.stampOf.length && this.stampOf[featureId] === this.stamp
      ? (this.vals[this.posOf[featureId] as number] as number)
      : -1;
  }

  /** Close the line under role category `categoryId`; returns its entry id. */
  end(categoryId: number): number {
    const id = this.categories.length;
    this.categories.push(categoryId);
    this.layouts.push(this.schema.layoutId(this.keys));
    const n = this.vals.length;
    if (this.valueCount + n > this.values.length) {
      const grown = new Uint32Array(Math.max(this.values.length * 2, this.valueCount + n));
      grown.set(this.values);
      this.values = grown;
    }
    for (let i = 0; i < n; i++) {
      this.values[this.valueCount++] = this.vals[i] as number;
    }
    this.starts.push(this.valueCount);
    return id;
  }

  /**
   * The finished table: values mapped through `remap` (provisional to final
   * string ids), widths chosen from the counts, and, with `dense`, the dense
   * rows over the final Feature_Name list.
   */
  finish(
    schema: FeatureSchema,
    remap: Int32Array,
    categoryCount: number,
    dense: boolean,
  ): EntryTable {
    const values = this.values.slice(0, this.valueCount);
    for (let i = 0; i < values.length; i++) {
      values[i] = remap[values[i] as number] as number;
    }
    const count = this.categories.length;
    const valueStart = Uint32Array.from(this.starts);
    const layout = idArray(this.layouts, schema.layouts.length - 1);
    let rows: Int32Array | null = null;
    if (dense) {
      const f = schema.names.length;
      rows = new Int32Array(count * f).fill(-1);
      for (let e = 0; e < count; e++) {
        const keys = schema.layouts[layout[e] as number] as IdArray;
        const base = valueStart[e] as number;
        for (let p = 0; p < keys.length; p++) {
          rows[e * f + (keys[p] as number)] = values[base + p] as number;
        }
      }
    }
    return {
      count,
      category: idArray(this.categories, categoryCount - 1),
      layout,
      valueStart,
      values,
      dense: rows,
    };
  }

  private growScratch(featureId: number): void {
    const size = Math.max(this.stampOf.length * 2, featureId + 1);
    const posOf = new Int32Array(size);
    posOf.set(this.posOf);
    const stampOf = new Uint32Array(size);
    stampOf.set(this.stampOf);
    this.posOf = posOf;
    this.stampOf = stampOf;
  }
}

/** Builds a {@link KeyIndex} from `(key, entry id)` pairs added in line order. */
export class KeyIndexBuilder {
  readonly slots = new Map<string, number>();
  private readonly entrySlots: number[] = [];
  private readonly entryIds: number[] = [];

  add(key: string, entryId: number): void {
    let slot = this.slots.get(key);
    if (slot === undefined) {
      slot = this.slots.size;
      this.slots.set(key, slot);
    }
    this.entrySlots.push(slot);
    this.entryIds.push(entryId);
  }

  finish(): KeyIndex {
    const { start, ids } = compressRows(this.entrySlots, this.entryIds, this.slots.size);
    return { slots: this.slots, start, ids };
  }
}

/**
 * An {@link IdIndex} over `slotCount` dense slots, where entry `e` sits in
 * slot `slotOf[e]`; each slot's entries in entry order.
 */
export function idIndex(slotOf: ArrayLike<number>, slotCount: number): IdIndex {
  const entryIds = new Array<number>(slotOf.length);
  for (let e = 0; e < slotOf.length; e++) {
    entryIds[e] = e;
  }
  return compressRows(slotOf, entryIds, slotCount);
}

/** Compressed sparse rows from parallel `(slot, id)` lists, keeping their order within a slot. */
function compressRows(
  slots: ArrayLike<number>,
  ids: ArrayLike<number>,
  slotCount: number,
): { start: Uint32Array; ids: Uint32Array } {
  const start = new Uint32Array(slotCount + 1);
  for (let i = 0; i < slots.length; i++) {
    const s = (slots[i] as number) + 1;
    start[s] = (start[s] as number) + 1;
  }
  for (let s = 0; s < slotCount; s++) {
    start[s + 1] = (start[s + 1] as number) + (start[s] as number);
  }
  const fill = start.slice(0, slotCount);
  const out = new Uint32Array(slots.length);
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i] as number;
    out[fill[s] as number] = ids[i] as number;
    fill[s] = (fill[s] as number) + 1;
  }
  return { start, ids: out };
}
