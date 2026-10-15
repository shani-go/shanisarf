// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The Model_Codec. It turns a model's two parts into Part_Meta and typed-array
// Sections, and back. It is the only code that knows both the tuple model's
// internals and the Section names, and it does no I/O: bytes, files,
// compression and hashes live in `src/load/` and `src/compile/`. Its one
// import from there is the error it throws.
//
// Encoding. `encodeModel` refuses a model without both sides, because an Asset
// carries every table, and reads the parts through `splitModel`. Each part's
// strings are one text, UTF-8 (or UTF-16 code units when a string of the part
// holds a lone surrogate, which UTF-8 cannot carry), and a `Uint32Array` of
// code-unit lengths. A string-keyed index stores its keys as String_Table ids
// in slot order. The Section list, its element types and its Filters are fixed
// by Format_Version 1 (`HEADER_SECTIONS`, `STEM_SECTIONS`).
//
// Only what cannot be derived is stored. The affix tables' dense rows, the
// three bitsets, each pair list's `rowOf`, the category indexes, the lemma
// index and the two maximum affix sizes are functions of the stored Sections,
// so the decoder rebuilds them exactly as `ModelBuilder` builds them, and no
// Asset can carry a copy that disagrees with its source.
//
// Decoding runs in three stages, and nothing is handed to `MorphologyDb`
// until the first two pass:
//
//   1. shape: every Section present, in order, of its type and of the
//      length the Part_Meta implies; the Part_Meta well formed;
//   2. ranges: start arrays from 0, non-decreasing, ending at their array's
//      length; every id within its range (string ids within their part's,
//      Layout keys below F, category, Layout and entry ids below their
//      counts, pair ids within the opposite role); every Tuple as long as
//      its Layout; every index holding each entry once, in line order; the
//      string lengths adding up to the text; every key list (index keys,
//      role names, Feature_Names, the header sections' keys, each Layout's
//      keys, each pair row's ids) distinct. A failure throws
//      `AssetFormatError` naming the Section;
//   3. build: strings decoded into fresh copies, slot and role Maps rebuilt
//      from ids, and only the tables the flags need, laid out as
//      `ModelBuilder` lays them out under those flags.
//
// This is a new-design file: project header only, in the ported-code check's
// exclusions. Internal: nothing here is exported from `index.ts`.

import { AssetFormatError } from '../load/errors.js';

import type { Bitset, CategoryRole, PairOrder } from './compat-bitset.js';
import {
  type DatabaseFlags,
  type HeaderPart,
  MODEL,
  MorphologyDb,
  PROVENANCE,
  type Provenance,
  splitModel,
  type StemPart,
  type TupleModel,
} from './database.js';
import {
  type EntryTable,
  type FeatureSchema,
  type IdArray,
  idIndex,
  type KeyIndex,
  KeyIndexBuilder,
} from './feature-schema.js';
import { pyLen } from './python-compat.js';
import { freshCopy } from './string-table.js';

/** A Section's reversible transform. */
export type Filter = 'none' | 'shuffle' | 'delta-shuffle';

/** A Section's typed array. */
export type SectionArray = Uint8Array | Uint16Array | Uint32Array | Int32Array;

/** A Section's element type, as the Directory names it. */
export type SectionType = 'u8' | 'u16' | 'u32' | 'i32';

/** How a part's string text is stored. */
export type StringEncoding = 'utf-8' | 'utf-16';

/** The header part's Part_Meta (JSON). */
export interface HeaderMeta {
  /** The flags the model was built with: always every table. */
  flags: DatabaseFlags;
  /** `defines` in order; a value that upstream stores as `None` is `null`. */
  defines: [string, (string | null)[] | null][];
  defaults: [string | null, [string, string | null][]][];
  order: string[] | null;
  tokenizations: string[];
  computeFeats: string[];
  stemBackoffs: [string, string[]][];
  /** The Feature_Name list: a Feature_Id is an index in it. */
  featureNames: string[];
  /** The strings of this part: String_Table ids 0 … headerCount - 1. */
  headerCount: number;
  stringEncoding: StringEncoding;
  counts: { prefixes: number; suffixes: number };
}

/** The stem part's Part_Meta (JSON). */
export interface StemMeta {
  stringEncoding: StringEncoding;
  /** The strings of this part: ids headerCount … headerCount + stringCount - 1. */
  stringCount: number;
  counts: { stems: number };
}

/** One Section as the encoder gives it: its name, its array and its Filter. */
export type EncodedSection = readonly [name: string, array: SectionArray, filter: Filter];

/** A part as the encoder gives it to the Container writer. */
export interface EncodedPart<M> {
  readonly meta: M;
  /** In Format_Version 1's order. */
  readonly sections: readonly EncodedSection[];
}

/** A part as the Container reader gives it back, Filters undone. */
export interface DecodedPart {
  /** The Directory's `meta`, not yet validated. */
  readonly meta: unknown;
  /** By name, in Container order. Each array is fresh and becomes the model's. */
  readonly sections: ReadonlyMap<string, SectionArray>;
  /** The Shard file the part came from, named in errors (set by the loader). */
  readonly path?: string;
}

/** The element type of `array`. */
export function sectionType(array: SectionArray): SectionType {
  if (array instanceof Uint8Array) return 'u8';
  if (array instanceof Uint16Array) return 'u16';
  if (array instanceof Uint32Array) return 'u32';
  return 'i32';
}

// ---------------------------------------------------------------------------
// Format_Version 1's Section lists.
// ---------------------------------------------------------------------------

/**
 * How a Section's element type is fixed: `text` by the part's string encoding
 * (`u8` UTF-8, `u16` UTF-16); `id:<count>` by the builder's width rule over
 * that count (`u16` when every id fits, `u32` otherwise); otherwise the type
 * itself.
 */
type TypeRule = 'text' | 'u32' | 'id:features' | 'id:layouts' | 'id:prefixCats' | 'id:stemCats' | 'id:suffixCats';

/** A Section of Format_Version 1: its name, its type rule, and whether it is a start (offset) array. */
type SectionSpec = readonly [name: string, type: TypeRule, start: boolean];

const pairOrderSpecs = (name: string): SectionSpec[] => [
  [`${name}.rows`, 'u32', false],
  [`${name}.start`, 'u32', true],
  [`${name}.ids`, 'u32', false],
];

const entryTableSpecs = (name: string, cats: TypeRule): SectionSpec[] => [
  [`${name}.category`, cats, false],
  [`${name}.layout`, 'id:layouts', false],
  [`${name}.valueStart`, 'u32', true],
  [`${name}.values`, 'u32', false],
];

const keyIndexSpecs = (name: string): SectionSpec[] => [
  [`${name}.keys`, 'u32', false],
  [`${name}.start`, 'u32', true],
  [`${name}.ids`, 'u32', false],
];

/** The header part's Sections, in Container order (Format_Version 1). */
export const HEADER_SECTIONS: readonly SectionSpec[] = [
  ['strings.text', 'text', false],
  ['strings.lengths', 'u32', false],
  ['layouts.keys', 'id:features', false],
  ['layouts.start', 'u32', true],
  ['prefixCats.names', 'u32', false],
  ['stemCats.names', 'u32', false],
  ['suffixCats.names', 'u32', false],
  ...pairOrderSpecs('abOrder'),
  ...pairOrderSpecs('bcOrder'),
  ...pairOrderSpecs('acOrder'),
  ...pairOrderSpecs('stemPrefixOrder'),
  ...entryTableSpecs('prefixes', 'id:prefixCats'),
  ...entryTableSpecs('suffixes', 'id:suffixCats'),
  ...keyIndexSpecs('prefixIndex'),
  ...keyIndexSpecs('suffixIndex'),
];

/** The stem part's Sections, in Container order (Format_Version 1). */
export const STEM_SECTIONS: readonly SectionSpec[] = [
  ['strings.text', 'text', false],
  ['strings.lengths', 'u32', false],
  ...entryTableSpecs('stems', 'id:stemCats'),
  ...keyIndexSpecs('stemIndex'),
];

/** The Filter of a Section: `none` for bytes, `delta-shuffle` for a start array, else `shuffle`. */
function filterOf(spec: SectionSpec, array: SectionArray): Filter {
  if (array instanceof Uint8Array) return 'none';
  return spec[2] ? 'delta-shuffle' : 'shuffle';
}

/** The builder's width rule (`idArray`): `u16` when the largest id, `count - 1`, fits. */
function idType(count: number): SectionType {
  return count - 1 <= 0xffff ? 'u16' : 'u32';
}

// ---------------------------------------------------------------------------
// Encoding.
// ---------------------------------------------------------------------------

/**
 * Each part of `db` as Part_Meta and Sections, in Format_Version 1's order,
 * each Section with its Filter. The arrays are the model's own, not copies;
 * the Container writer copies them through their Filters.
 *
 * @throws {TypeError} when `db` was built without analysis or without
 *   generation (an Asset carries every table), or when its maximum affix sizes
 *   are not the ones its surfaces give (the decoder derives them).
 */
export function encodeModel(db: MorphologyDb): { header: EncodedPart<HeaderMeta>; stem: EncodedPart<StemMeta> } {
  if (!db.flags.analysis || !db.flags.generation) {
    throw new TypeError("encodeModel: an Asset carries every table; build the model with flags 'r'");
  }
  const [headerShard, stemShard] = splitModel(db);
  const h = headerShard.header;
  const s = stemShard.stem;
  const prefixIndex = h.prefixIndex as KeyIndex;
  const suffixIndex = h.suffixIndex as KeyIndex;
  const stemIndex = s.stemIndex as KeyIndex;
  if (h.maxPrefixSize !== maxSize(prefixIndex) || h.maxSuffixSize !== maxSize(suffixIndex)) {
    throw new TypeError('encodeModel: the maximum affix sizes are not the ones the affix surfaces give');
  }

  const headerCount = headerShard.strings.length;
  const idOf = new Map<string, number>();
  headerShard.strings.forEach((str, id) => idOf.set(str, id));
  stemShard.strings.forEach((str, i) => idOf.set(str, headerCount + i));
  const keyIds = (index: KeyIndex): Uint32Array => {
    const keys = new Uint32Array(index.slots.size);
    for (const [key, slot] of index.slots) {
      const id = idOf.get(key);
      if (id === undefined) {
        throw new Error(`encodeModel: the index key ${JSON.stringify(key)} is not in the String_Table`);
      }
      keys[slot] = id;
    }
    return keys;
  };

  const schema = h.schema;
  const layoutStart = new Uint32Array(schema.layouts.length + 1);
  schema.layouts.forEach((keys, l) => (layoutStart[l + 1] = (layoutStart[l] as number) + keys.length));
  const layoutKeys = idType(schema.names.length) === 'u16'
    ? new Uint16Array(layoutStart[schema.layouts.length] as number)
    : new Uint32Array(layoutStart[schema.layouts.length] as number);
  schema.layouts.forEach((keys, l) => layoutKeys.set(keys, layoutStart[l] as number));

  const headerText = encodeStrings(headerShard.strings);
  const stemText = encodeStrings(stemShard.strings);
  const pair = (o: PairOrder): SectionArray[] => [o.rows, o.start, o.ids];
  const table = (t: EntryTable): SectionArray[] => [t.category, t.layout, t.valueStart, t.values];
  const index = (i: KeyIndex): SectionArray[] => [keyIds(i), i.start, i.ids];

  const headerArrays: SectionArray[] = [
    headerText.text,
    headerText.lengths,
    layoutKeys,
    layoutStart,
    h.prefixCats.names,
    h.stemCats.names,
    h.suffixCats.names,
    ...pair(h.abOrder),
    ...pair(h.bcOrder),
    ...pair(h.acOrder),
    ...pair(h.stemPrefixOrder),
    ...table(h.prefixes),
    ...table(h.suffixes),
    ...index(prefixIndex),
    ...index(suffixIndex),
  ];
  const stemArrays: SectionArray[] = [stemText.text, stemText.lengths, ...table(s.stems), ...index(stemIndex)];

  const header: HeaderMeta = {
    flags: { analysis: true, generation: true, reinflection: true },
    defines: [...h.defines].map(([k, v]) => [k, v === null ? null : v.map((x) => (x === undefined ? null : x))]),
    defaults: [...h.defaults].map(([k, row]) => [k, Object.entries(row)]),
    order: h.order === null ? null : [...h.order],
    tokenizations: [...h.tokenizations],
    computeFeats: [...h.computeFeats],
    stemBackoffs: [...h.stemBackoffs].map(([k, v]) => [k, [...v]]),
    featureNames: [...schema.names],
    headerCount,
    stringEncoding: headerText.encoding,
    counts: { prefixes: h.prefixes.count, suffixes: h.suffixes.count },
  };
  const stem: StemMeta = {
    stringEncoding: stemText.encoding,
    stringCount: stemShard.strings.length,
    counts: { stems: s.stems.count },
  };
  return {
    header: { meta: header, sections: withFilters(HEADER_SECTIONS, headerArrays) },
    stem: { meta: stem, sections: withFilters(STEM_SECTIONS, stemArrays) },
  };
}

function withFilters(specs: readonly SectionSpec[], arrays: SectionArray[]): EncodedSection[] {
  return specs.map((spec, i) => {
    const array = arrays[i] as SectionArray;
    return [spec[0], array, filterOf(spec, array)] as const;
  });
}

/** The longest surface of `index`, in code points (the parser's bound), or 0. */
function maxSize(index: KeyIndex | null): number {
  let max = 0;
  for (const surface of index?.slots.keys() ?? []) {
    max = Math.max(max, pyLen(surface));
  }
  return max;
}

/** Whether `s` holds a UTF-16 code unit of a surrogate that is not one half of a pair. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** A part's strings as one text and their code-unit lengths. */
function encodeStrings(strings: readonly string[]): {
  encoding: StringEncoding;
  text: Uint8Array | Uint16Array;
  lengths: Uint32Array;
} {
  const lengths = Uint32Array.from(strings, (s) => s.length);
  const joined = strings.join('');
  if (!strings.some(hasLoneSurrogate)) {
    return { encoding: 'utf-8', text: new TextEncoder().encode(joined), lengths };
  }
  const units = new Uint16Array(joined.length);
  for (let i = 0; i < joined.length; i++) {
    units[i] = joined.charCodeAt(i);
  }
  return { encoding: 'utf-16', text: units, lengths };
}

// ---------------------------------------------------------------------------
// Decoding.
// ---------------------------------------------------------------------------

type PartName = 'header' | 'stems';

/** Throws the codec's `AssetFormatError` for `section` of a part. */
function fail(part: PartName, path: string | undefined, section: string, detail: string): never {
  const where = path === undefined ? `${part} part` : path;
  throw new AssetFormatError(`${where}, section ${section}: ${detail}`, { path: path ?? null, section });
}

/** Reads a part's Sections in Format_Version 1's order, checking each name, type and length. */
class SectionReader {
  readonly part: PartName;
  readonly path: string | undefined;
  private readonly sections: ReadonlyMap<string, SectionArray>;
  private readonly names: string[];
  private next = 0;

  constructor(part: PartName, decoded: DecodedPart) {
    this.part = part;
    this.path = decoded.path;
    this.sections = decoded.sections;
    this.names = [...decoded.sections.keys()];
  }

  fail(section: string, detail: string): never {
    return fail(this.part, this.path, section, detail);
  }

  /** The next Section, which must be `name`, of `type`, and of `length` elements when given. */
  take(name: string, type: SectionType, length?: number): SectionArray {
    const array = this.sections.get(name);
    if (array === undefined) {
      this.fail(name, 'the Section is missing');
    }
    if (this.names[this.next] !== name) {
      this.fail(name, `the Section is out of order (expected at position ${this.next})`);
    }
    this.next++;
    const actual = sectionType(array);
    if (actual !== type) {
      this.fail(name, `the Section is ${actual}, expected ${type}`);
    }
    if (length !== undefined && array.length !== length) {
      this.fail(name, `the Section holds ${array.length} elements, expected ${length}`);
    }
    return array;
  }

  u32(name: string, length?: number): Uint32Array {
    return this.take(name, 'u32', length) as Uint32Array;
  }

  ids(name: string, count: number, length: number): IdArray {
    return this.take(name, idType(count), length) as IdArray;
  }

  /** Every Section has been read. */
  end(): void {
    if (this.next < this.names.length) {
      this.fail(this.names[this.next] as string, 'the Section is not one of Format_Version 1');
    }
  }
}

/** Part_Meta field checks. */
class MetaReader {
  readonly part: PartName;
  readonly path: string | undefined;

  constructor(part: PartName, path: string | undefined) {
    this.part = part;
    this.path = path;
  }

  fail(field: string, detail: string): never {
    return fail(this.part, this.path, `meta.${field}`, detail);
  }

  object(value: unknown, field: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.fail(field, 'is not an object');
    }
    return value as Record<string, unknown>;
  }

  count(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      this.fail(field, 'is not a non-negative safe integer');
    }
    return value;
  }

  string(value: unknown, field: string): string {
    if (typeof value !== 'string') {
      this.fail(field, 'is not a string');
    }
    return freshCopy(value);
  }

  stringOrNull(value: unknown, field: string): string | null {
    return value === null ? null : this.string(value, field);
  }

  array(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value)) {
      this.fail(field, 'is not an array');
    }
    return value;
  }

  strings(value: unknown, field: string): string[] {
    return this.array(value, field).map((v) => this.string(v, field));
  }

  pair(value: unknown, field: string): [unknown, unknown] {
    const a = this.array(value, field);
    if (a.length !== 2) {
      this.fail(field, 'holds an entry that is not a pair');
    }
    return a as [unknown, unknown];
  }

  encoding(value: unknown, field: string): StringEncoding {
    if (value !== 'utf-8' && value !== 'utf-16') {
      this.fail(field, "is not 'utf-8' or 'utf-16'");
    }
    return value;
  }

  /** The keys of `entries` are distinct, as the Map or Set they become needs. */
  distinct<K>(keys: readonly K[], field: string): void {
    if (new Set(keys).size !== keys.length) {
      this.fail(field, 'holds a key twice');
    }
  }
}

/** The header Part_Meta, validated; every string a fresh copy. */
interface HeaderInfo {
  defines: Map<string, string[] | null>;
  defaults: Map<string | null, Record<string, string | null>>;
  order: string[] | null;
  tokenizations: Set<string>;
  computeFeats: Set<string>;
  stemBackoffs: Map<string, string[]>;
  featureNames: string[];
  headerCount: number;
  stringEncoding: StringEncoding;
  prefixCount: number;
  suffixCount: number;
}

function readHeaderMeta(decoded: DecodedPart): HeaderInfo {
  const m = new MetaReader('header', decoded.path);
  const meta = m.object(decoded.meta, '');
  const flags = m.object(meta['flags'], 'flags');
  if (flags['analysis'] !== true || flags['generation'] !== true || flags['reinflection'] !== true) {
    m.fail('flags', 'an Asset carries every table, but these flags lack some');
  }

  const defineList = m.array(meta['defines'], 'defines').map((entry) => {
    const [name, values] = m.pair(entry, 'defines');
    const list =
      values === null
        ? null
        : m.array(values, 'defines').map((v) =>
            // Upstream can store `None` in a define's value set; it crosses as null.
            v === null ? (undefined as unknown as string) : m.string(v, 'defines'),
          );
    return [m.string(name, 'defines'), list] as const;
  });
  m.distinct(defineList.map(([k]) => k), 'defines');

  const defaultList = m.array(meta['defaults'], 'defaults').map((entry) => {
    const [key, row] = m.pair(entry, 'defaults');
    const record: Record<string, string | null> = {};
    const fields = m.array(row, 'defaults').map((field) => {
      const [feat, value] = m.pair(field, 'defaults');
      return [m.string(feat, 'defaults'), m.stringOrNull(value, 'defaults')] as const;
    });
    m.distinct(fields.map(([k]) => k), 'defaults');
    for (const [feat, value] of fields) {
      record[feat] = value;
    }
    return [m.stringOrNull(key, 'defaults'), record] as const;
  });
  m.distinct(defaultList.map(([k]) => k), 'defaults');

  const order = meta['order'] === null ? null : m.strings(meta['order'], 'order');
  const tokenizations = m.strings(meta['tokenizations'], 'tokenizations');
  m.distinct(tokenizations, 'tokenizations');
  const computeFeats = m.strings(meta['computeFeats'], 'computeFeats');
  m.distinct(computeFeats, 'computeFeats');
  const backoffList = m.array(meta['stemBackoffs'], 'stemBackoffs').map((entry) => {
    const [name, cats] = m.pair(entry, 'stemBackoffs');
    return [m.string(name, 'stemBackoffs'), m.strings(cats, 'stemBackoffs')] as const;
  });
  m.distinct(backoffList.map(([k]) => k), 'stemBackoffs');
  const featureNames = m.strings(meta['featureNames'], 'featureNames');
  m.distinct(featureNames, 'featureNames');
  const counts = m.object(meta['counts'], 'counts');

  return {
    defines: new Map(defineList),
    defaults: new Map(defaultList),
    order,
    tokenizations: new Set(tokenizations),
    computeFeats: new Set(computeFeats),
    stemBackoffs: new Map(backoffList),
    featureNames,
    headerCount: m.count(meta['headerCount'], 'headerCount'),
    stringEncoding: m.encoding(meta['stringEncoding'], 'stringEncoding'),
    prefixCount: m.count(counts['prefixes'], 'counts.prefixes'),
    suffixCount: m.count(counts['suffixes'], 'counts.suffixes'),
  };
}

interface StemInfo {
  stringEncoding: StringEncoding;
  stringCount: number;
  stemCount: number;
}

function readStemMeta(decoded: DecodedPart): StemInfo {
  const m = new MetaReader('stems', decoded.path);
  const meta = m.object(decoded.meta, '');
  const counts = m.object(meta['counts'], 'counts');
  return {
    stringEncoding: m.encoding(meta['stringEncoding'], 'stringEncoding'),
    stringCount: m.count(meta['stringCount'], 'stringCount'),
    stemCount: m.count(counts['stems'], 'counts.stems'),
  };
}

/** A pair list's stored Sections. */
interface StoredPairs {
  name: string;
  rows: Uint32Array;
  start: Uint32Array;
  ids: Uint32Array;
}

/** An entry table's stored Sections. */
interface StoredTable {
  name: string;
  count: number;
  category: IdArray;
  layout: IdArray;
  valueStart: Uint32Array;
  values: Uint32Array;
}

/** A key index's stored Sections. */
interface StoredIndex {
  name: string;
  keys: Uint32Array;
  start: Uint32Array;
  ids: Uint32Array;
}

function takePairs(r: SectionReader, name: string): StoredPairs {
  const rows = r.u32(`${name}.rows`);
  const start = r.u32(`${name}.start`, rows.length + 1);
  const ids = r.u32(`${name}.ids`);
  return { name, rows, start, ids };
}

function takeTable(r: SectionReader, name: string, count: number, categories: number, layouts: number): StoredTable {
  const category = r.ids(`${name}.category`, categories, count);
  const layout = r.ids(`${name}.layout`, layouts, count);
  const valueStart = r.u32(`${name}.valueStart`, count + 1);
  const values = r.u32(`${name}.values`);
  return { name, count, category, layout, valueStart, values };
}

function takeIndex(r: SectionReader, name: string, entries: number): StoredIndex {
  const keys = r.u32(`${name}.keys`);
  const start = r.u32(`${name}.start`, keys.length + 1);
  const ids = r.u32(`${name}.ids`, entries);
  return { name, keys, start, ids };
}

/** A start array begins at 0, never decreases, and ends at `total`. */
function checkStart(r: SectionReader, name: string, start: Uint32Array, total: number): void {
  if (start[0] !== 0) {
    r.fail(name, 'does not begin at 0');
  }
  for (let i = 1; i < start.length; i++) {
    if ((start[i] as number) < (start[i - 1] as number)) {
      r.fail(name, `decreases at element ${i}`);
    }
  }
  if (start[start.length - 1] !== total) {
    r.fail(name, `ends at ${start[start.length - 1]}, not at ${total}`);
  }
}

/** Every element of `array` is below `limit`. */
function checkBelow(r: SectionReader, name: string, array: ArrayLike<number>, limit: number, what: string): void {
  for (let i = 0; i < array.length; i++) {
    if ((array[i] as number) >= limit) {
      r.fail(name, `${what} ${array[i]} at element ${i} is not below ${limit}`);
    }
  }
}

/** A pair list: rows distinct and within the left role, ids within the right role and distinct per row. */
function checkPairs(r: SectionReader, p: StoredPairs, left: number, right: number): void {
  checkBelow(r, `${p.name}.rows`, p.rows, left, 'the role id');
  const seenRow = new Uint8Array(left);
  for (let i = 0; i < p.rows.length; i++) {
    const row = p.rows[i] as number;
    if (seenRow[row] === 1) {
      r.fail(`${p.name}.rows`, `the role id ${row} heads two rows`);
    }
    seenRow[row] = 1;
  }
  checkStart(r, `${p.name}.start`, p.start, p.ids.length);
  checkBelow(r, `${p.name}.ids`, p.ids, right, 'the role id');
  const stamp = new Uint32Array(right);
  for (let row = 0; row < p.rows.length; row++) {
    for (let k = p.start[row] as number; k < (p.start[row + 1] as number); k++) {
      const id = p.ids[k] as number;
      if (stamp[id] === row + 1) {
        r.fail(`${p.name}.ids`, `row ${row} holds the role id ${id} twice`);
      }
      stamp[id] = row + 1;
    }
  }
}

/** An entry table: ids within their counts, each Tuple as long as its Layout, values within `strings`. */
function checkTable(
  r: SectionReader,
  t: StoredTable,
  categories: number,
  layoutLengths: Uint32Array,
  strings: number,
): void {
  checkBelow(r, `${t.name}.category`, t.category, categories, 'the category id');
  checkBelow(r, `${t.name}.layout`, t.layout, layoutLengths.length, 'the Layout id');
  if (t.valueStart[0] !== 0) {
    r.fail(`${t.name}.valueStart`, 'does not begin at 0');
  }
  for (let e = 0; e < t.count; e++) {
    const width = (t.valueStart[e + 1] as number) - (t.valueStart[e] as number);
    if (width !== layoutLengths[t.layout[e] as number]) {
      r.fail(`${t.name}.valueStart`, `entry ${e} holds ${width} values, but its Layout has ${layoutLengths[t.layout[e] as number]} keys`);
    }
  }
  if (t.valueStart[t.count] !== t.values.length) {
    r.fail(`${t.name}.valueStart`, `ends at ${t.valueStart[t.count]}, not at ${t.values.length}`);
  }
  checkBelow(r, `${t.name}.values`, t.values, strings, 'the string id');
}

/** A key index: keys within `strings`, and every entry once, in line order within its slot. */
function checkIndex(r: SectionReader, x: StoredIndex, entries: number, strings: number): void {
  checkBelow(r, `${x.name}.keys`, x.keys, strings, 'the string id');
  checkStart(r, `${x.name}.start`, x.start, x.ids.length);
  checkBelow(r, `${x.name}.ids`, x.ids, entries, 'the entry id');
  const seen = new Uint8Array(entries);
  for (let slot = 0; slot < x.keys.length; slot++) {
    let last = -1;
    for (let k = x.start[slot] as number; k < (x.start[slot + 1] as number); k++) {
      const id = x.ids[k] as number;
      if (seen[id] === 1) {
        r.fail(`${x.name}.ids`, `the entry ${id} is indexed twice`);
      }
      if (id < last) {
        r.fail(`${x.name}.ids`, `slot ${slot} is not in line order`);
      }
      seen[id] = 1;
      last = id;
    }
  }
}

/**
 * A part's strings, decoded into fresh copies after their lengths are
 * checked against the text, written into `out` from `first` on.
 */
function decodeStrings(
  r: SectionReader,
  text: SectionArray,
  lengths: Uint32Array,
  encoding: StringEncoding,
  out: string[],
  first: number,
): void {
  let total = 0;
  for (let i = 0; i < lengths.length; i++) {
    total += lengths[i] as number;
  }
  if (encoding === 'utf-8') {
    let joined: string;
    try {
      joined = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(text);
    } catch {
      r.fail('strings.text', 'is not UTF-8');
    }
    if (total !== joined.length) {
      r.fail('strings.lengths', `add up to ${total} code units, but the text holds ${joined.length}`);
    }
    for (let i = 0, at = 0; i < lengths.length; i++) {
      const end = at + (lengths[i] as number);
      out[first + i] = freshCopy(joined.slice(at, end));
      at = end;
    }
    return;
  }
  if (total !== text.length) {
    r.fail('strings.lengths', `add up to ${total} code units, but the text holds ${text.length}`);
  }
  for (let i = 0, at = 0; i < lengths.length; i++) {
    const end = at + (lengths[i] as number);
    out[first + i] = fromCodeUnits(text as Uint16Array, at, end);
    at = end;
  }
}

/** The string of UTF-16 code units `units[start .. end)`, built in chunks. */
function fromCodeUnits(units: Uint16Array, start: number, end: number): string {
  let s = '';
  for (let at = start; at < end; at += 4096) {
    s += String.fromCharCode.apply(null, units.subarray(at, Math.min(end, at + 4096)) as unknown as number[]);
  }
  return s;
}

/** Name → id over `ids`, failing when two ids name equal strings. */
function nameMap(r: SectionReader, section: string, ids: ArrayLike<number>, strings: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < ids.length; i++) {
    const key = strings[ids[i] as number] as string;
    if (map.has(key)) {
      r.fail(section, `holds the key ${JSON.stringify(key)} twice`);
    }
    map.set(key, i);
  }
  return map;
}

/** A pair list and its bitset, as `PairTableBuilder` builds them, or empty of that shape. */
function buildPairs(p: StoredPairs | null, left: number, right: number): { order: PairOrder; bitset: Bitset } {
  const words = Math.ceil(right / 32);
  const bits = new Uint32Array(left * words);
  const rowOf = new Int32Array(left).fill(-1);
  if (p === null) {
    return {
      order: { rows: new Uint32Array(0), rowOf, start: new Uint32Array(1), ids: new Uint32Array(0) },
      bitset: { rows: left, cols: right, words, bits },
    };
  }
  for (let row = 0; row < p.rows.length; row++) {
    const l = p.rows[row] as number;
    rowOf[l] = row;
    for (let k = p.start[row] as number; k < (p.start[row + 1] as number); k++) {
      const c = p.ids[k] as number;
      const w = l * words + (c >>> 5);
      bits[w] = ((bits[w] as number) | (1 << (c & 31))) >>> 0;
    }
  }
  return {
    order: { rows: p.rows, rowOf, start: p.start, ids: p.ids },
    bitset: { rows: left, cols: right, words, bits },
  };
}

/** An entry table, with dense rows over `features` Feature_Ids when `dense` (as `EntryTableBuilder.finish`). */
function buildTable(t: StoredTable, layouts: readonly IdArray[], features: number, dense: boolean): EntryTable {
  let rows: Int32Array | null = null;
  if (dense) {
    rows = new Int32Array(t.count * features).fill(-1);
    for (let e = 0; e < t.count; e++) {
      const keys = layouts[t.layout[e] as number] as IdArray;
      const base = t.valueStart[e] as number;
      for (let p = 0; p < keys.length; p++) {
        rows[e * features + (keys[p] as number)] = t.values[base + p] as number;
      }
    }
  }
  return { count: t.count, category: t.category, layout: t.layout, valueStart: t.valueStart, values: t.values, dense: rows };
}

/**
 * A model from its two decoded parts, under `flags`, carrying `provenance`.
 * Every check runs before anything is built; a model opened with `a`, `g` or
 * `r` equals `parseAlmor(text, { flags })` of the text the parts were encoded
 * from.
 *
 * @throws {AssetFormatError} naming the Section (or `meta.<field>`) that
 *   fails a check.
 */
export function decodeModel(
  header: DecodedPart,
  stem: DecodedPart,
  flags: Readonly<DatabaseFlags>,
  provenance: Provenance | null,
): MorphologyDb {
  // --- Stage 1: shape.
  const hi = readHeaderMeta(header);
  const si = readStemMeta(stem);
  const features = hi.featureNames.length;
  const totalStrings = hi.headerCount + si.stringCount;

  const hr = new SectionReader('header', header);
  const headerTextType = hi.stringEncoding === 'utf-8' ? 'u8' : 'u16';
  const headerText = hr.take('strings.text', headerTextType);
  const headerLengths = hr.u32('strings.lengths', hi.headerCount);
  const layoutKeys = hr.take('layouts.keys', idType(features)) as IdArray;
  const layoutStart = hr.u32('layouts.start');
  if (layoutStart.length === 0) {
    hr.fail('layouts.start', 'is empty; it holds one more element than there are Layouts');
  }
  const layoutCount = layoutStart.length - 1;
  const prefixNames = hr.u32('prefixCats.names');
  const stemNames = hr.u32('stemCats.names');
  const suffixNames = hr.u32('suffixCats.names');
  const p = prefixNames.length;
  const st = stemNames.length;
  const x = suffixNames.length;
  const ab = takePairs(hr, 'abOrder');
  const bc = takePairs(hr, 'bcOrder');
  const ac = takePairs(hr, 'acOrder');
  const stemPrefix = takePairs(hr, 'stemPrefixOrder');
  const prefixes = takeTable(hr, 'prefixes', hi.prefixCount, p, layoutCount);
  const suffixes = takeTable(hr, 'suffixes', hi.suffixCount, x, layoutCount);
  const prefixIndex = takeIndex(hr, 'prefixIndex', hi.prefixCount);
  const suffixIndex = takeIndex(hr, 'suffixIndex', hi.suffixCount);
  hr.end();

  const sr = new SectionReader('stems', stem);
  const stemText = sr.take('strings.text', si.stringEncoding === 'utf-8' ? 'u8' : 'u16');
  const stemLengths = sr.u32('strings.lengths', si.stringCount);
  const stems = takeTable(sr, 'stems', si.stemCount, st, layoutCount);
  const stemIndex = takeIndex(sr, 'stemIndex', si.stemCount);
  sr.end();

  // --- Stage 2: ranges.
  checkStart(hr, 'layouts.start', layoutStart, layoutKeys.length);
  checkBelow(hr, 'layouts.keys', layoutKeys, features, 'the Feature_Id');
  const layoutLengths = new Uint32Array(layoutCount);
  const layoutStamp = new Uint32Array(features);
  for (let l = 0; l < layoutCount; l++) {
    layoutLengths[l] = (layoutStart[l + 1] as number) - (layoutStart[l] as number);
    for (let k = layoutStart[l] as number; k < (layoutStart[l + 1] as number); k++) {
      const f = layoutKeys[k] as number;
      if (layoutStamp[f] === l + 1) {
        hr.fail('layouts.keys', `Layout ${l} holds the Feature_Id ${f} twice`);
      }
      layoutStamp[f] = l + 1;
    }
  }
  checkBelow(hr, 'prefixCats.names', prefixNames, hi.headerCount, 'the string id');
  checkBelow(hr, 'stemCats.names', stemNames, hi.headerCount, 'the string id');
  checkBelow(hr, 'suffixCats.names', suffixNames, hi.headerCount, 'the string id');
  checkPairs(hr, ab, p, st);
  checkPairs(hr, bc, st, x);
  checkPairs(hr, ac, p, x);
  checkPairs(hr, stemPrefix, st, p);
  checkTable(hr, prefixes, p, layoutLengths, hi.headerCount);
  checkTable(hr, suffixes, x, layoutLengths, hi.headerCount);
  checkIndex(hr, prefixIndex, hi.prefixCount, hi.headerCount);
  checkIndex(hr, suffixIndex, hi.suffixCount, hi.headerCount);
  checkTable(sr, stems, st, layoutLengths, totalStrings);
  checkIndex(sr, stemIndex, si.stemCount, totalStrings);

  // The strings, fresh copies, and every key list over them distinct.
  // One exact-size String_Table, as the builder's `seal()` makes it.
  const strings = new Array<string>(totalStrings);
  decodeStrings(hr, headerText, headerLengths, hi.stringEncoding, strings, 0);
  decodeStrings(sr, stemText, stemLengths, si.stringEncoding, strings, hi.headerCount);
  const prefixCatIds = nameMap(hr, 'prefixCats.names', prefixNames, strings);
  const stemCatIds = nameMap(hr, 'stemCats.names', stemNames, strings);
  const suffixCatIds = nameMap(hr, 'suffixCats.names', suffixNames, strings);
  const prefixSlots = nameMap(hr, 'prefixIndex.keys', prefixIndex.keys, strings);
  const suffixSlots = nameMap(hr, 'suffixIndex.keys', suffixIndex.keys, strings);
  const stemSlots = nameMap(sr, 'stemIndex.keys', stemIndex.keys, strings);

  // --- Stage 3: build, keeping only the tables the flags need.
  const analysis = flags.analysis;
  const generation = flags.generation;
  const layouts: IdArray[] = [];
  for (let l = 0; l < layoutCount; l++) {
    layouts.push(layoutKeys.slice(layoutStart[l], layoutStart[l + 1]));
  }
  const schema: FeatureSchema = {
    names: hi.featureNames,
    ids: new Map(hi.featureNames.map((name, id) => [name, id])),
    layouts,
  };
  const role = (names: Uint32Array, ids: Map<string, number>): CategoryRole => ({ names, ids });
  const abBuilt = buildPairs(analysis ? ab : null, p, st);
  const bcBuilt = buildPairs(bc, st, x);
  const acBuilt = buildPairs(ac, p, x);
  const stemPrefixBuilt = buildPairs(generation ? stemPrefix : null, st, p);
  const prefixTable = buildTable(prefixes, layouts, features, true);
  const suffixTable = buildTable(suffixes, layouts, features, true);
  const stemTable = buildTable(stems, layouts, features, false);
  const keyIndex = (stored: StoredIndex, slots: Map<string, number>): KeyIndex => ({
    slots,
    start: stored.start,
    ids: stored.ids,
  });
  const prefixKeys = analysis ? keyIndex(prefixIndex, prefixSlots) : null;
  const suffixKeys = analysis ? keyIndex(suffixIndex, suffixSlots) : null;

  const headerPart: HeaderPart = {
    flags: Object.freeze({ analysis, generation, reinflection: flags.reinflection }),
    defines: hi.defines,
    defaults: hi.defaults,
    order: hi.order,
    tokenizations: hi.tokenizations,
    computeFeats: hi.computeFeats,
    stemBackoffs: hi.stemBackoffs,
    schema,
    prefixCats: role(prefixNames, prefixCatIds),
    stemCats: role(stemNames, stemCatIds),
    suffixCats: role(suffixNames, suffixCatIds),
    ab: abBuilt.bitset,
    bc: bcBuilt.bitset,
    ac: acBuilt.bitset,
    abOrder: abBuilt.order,
    bcOrder: bcBuilt.order,
    acOrder: acBuilt.order,
    stemPrefixOrder: stemPrefixBuilt.order,
    prefixes: prefixTable,
    suffixes: suffixTable,
    prefixIndex: prefixKeys,
    suffixIndex: suffixKeys,
    prefixCatIndex: generation ? idIndex(prefixTable.category, p) : null,
    suffixCatIndex: generation ? idIndex(suffixTable.category, x) : null,
    maxPrefixSize: maxSize(prefixKeys),
    maxSuffixSize: maxSize(suffixKeys),
  };
  const stemPart: StemPart = {
    stems: stemTable,
    stemIndex: analysis ? keyIndex(stemIndex, stemSlots) : null,
    lemmaIndex: generation ? lemmaIndexOf(stemTable, schema, strings) : null,
  };
  const model: TupleModel = { header: headerPart, stem: stemPart, strings: { strings, headerCount: hi.headerCount } };
  return new MorphologyDb({ [MODEL]: model, [PROVENANCE]: provenance });
}

/**
 * The lemma index as the parser builds it: each stem with a `lex` value, in
 * line order, under that value; keys in first-seen order.
 */
function lemmaIndexOf(stems: EntryTable, schema: FeatureSchema, strings: readonly string[]): KeyIndex {
  const lemmas = new KeyIndexBuilder();
  const lex = schema.ids.get('lex');
  if (lex !== undefined) {
    const at = Int32Array.from(schema.layouts, (keys) => keys.indexOf(lex));
    for (let e = 0; e < stems.count; e++) {
      const p = at[stems.layout[e] as number] as number;
      if (p !== -1) {
        lemmas.add(strings[stems.values[(stems.valueStart[e] as number) + p] as number] as string, e);
      }
    }
  }
  return lemmas.finish();
}
