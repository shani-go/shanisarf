// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The read-only Views over the tuple model. `MorphologyDb`'s table fields keep
// a Map-and-Set read API and iteration order while the model underneath is
// typed arrays:
//
// - `prefixes`, `suffixes`, `stems`, `lemmaHash`: a surface (or lemma) to its
//   entries, keys in first-seen order, entries in line order.
// - `prefixCatHash`, `suffixCatHash`: a category to its lines' feature
//   records, categories in first-seen order, records in line order.
// - `prefixStemCompat`, `stemSuffixCompat`, `prefixSuffixCompat`,
//   `stemPrefixCompat`: a category to the set of its compatible categories,
//   rows in first-seen order, members in line order.
//
// Everything materializes on access. Entries and their `features` are built
// in Layout order, frozen, and memoized per model and entry id in one
// EntryMemo shared by every View of the model, so the same entry is the same
// object however it is reached: a `prefixCatHash` record is `===` the
// matching `prefixes` entry's `features`, and a `lemmaHash` entry is `===`
// the matching `stems` entry. A key's array, and a row's set, is frozen and
// memoized too. The memo grows only with what is read. The Views are for
// tests, tools and diagnostics; a consumer that reads every stem through them
// gives back the tuple model's memory saving.
//
// A View whose index is absent (its side's flag is off) is empty.
//
// This is a new-design file: project header only, in the ported-code check's
// exclusions.

import type { CategoryRole, PairOrder } from './compat-bitset.js';
import type { Entry, TupleModel } from './database.js';
import type { EntryTable, IdArray, IdIndex, KeyIndex } from './feature-schema.js';

/** One of the three entry tables. */
export type TableName = 'prefixes' | 'suffixes' | 'stems';

function tableOf(model: TupleModel, name: TableName): EntryTable {
  return name === 'stems' ? model.stem.stems : model.header[name];
}

function roleOf(model: TupleModel, name: TableName): CategoryRole {
  const h = model.header;
  return name === 'prefixes' ? h.prefixCats : name === 'suffixes' ? h.suffixCats : h.stemCats;
}

/**
 * A `Set` that cannot change once built: `add`, `delete` and `clear` throw.
 * It stays a `Set`, so `instanceof Set` and set equality in tests hold.
 */
export class FrozenSet<T> extends Set<T> {
  #frozen = false;

  constructor(items: Iterable<T>) {
    super();
    for (const item of items) {
      super.add(item);
    }
    this.#frozen = true;
  }

  override add(value: T): this {
    if (this.#frozen) {
      throw new TypeError('the set is read-only');
    }
    return super.add(value);
  }

  override delete(value: T): boolean {
    if (this.#frozen) {
      throw new TypeError('the set is read-only');
    }
    return super.delete(value);
  }

  override clear(): void {
    if (this.#frozen) {
      throw new TypeError('the set is read-only');
    }
    super.clear();
  }
}

/** The per-model memo of materialized entries, shared by every View. */
export class EntryMemo {
  private readonly model: TupleModel;
  private readonly memo: Record<TableName, (Entry | undefined)[]>;

  constructor(model: TupleModel) {
    this.model = model;
    this.memo = {
      prefixes: new Array<Entry | undefined>(model.header.prefixes.count),
      suffixes: new Array<Entry | undefined>(model.header.suffixes.count),
      stems: new Array<Entry | undefined>(model.stem.stems.count),
    };
  }

  /** Entry `id` of `table`: its category and frozen features, in Layout order. */
  entry(table: TableName, id: number): Entry {
    const list = this.memo[table];
    const known = list[id];
    if (known !== undefined) {
      return known;
    }
    const model = this.model;
    const t = tableOf(model, table);
    const strings = model.strings.strings;
    const names = model.header.schema.names;
    const keys = model.header.schema.layouts[t.layout[id] as number] as IdArray;
    const base = t.valueStart[id] as number;
    const features: Record<string, string> = {};
    for (let p = 0; p < keys.length; p++) {
      features[names[keys[p] as number] as string] = strings[t.values[base + p] as number] as string;
    }
    const role = roleOf(model, table);
    const entry: Entry = Object.freeze({
      category: strings[role.names[t.category[id] as number] as number] as string,
      features: Object.freeze(features),
    });
    list[id] = entry;
    return entry;
  }
}

/** The entry ids of slot `slot` of a compressed-rows index. */
function slotIds(index: KeyIndex | IdIndex, slot: number): Uint32Array {
  return index.ids.subarray(index.start[slot], index.start[slot + 1]);
}

// The readers `entryMemoOf` uses, set by each View class's static block so
// that the memo stays a private field.
let entryViewMemo: (view: object) => EntryMemo | undefined = () => undefined;
let recordViewMemo: (view: object) => EntryMemo | undefined = () => undefined;

/**
 * The EntryMemo behind an `EntryMapView` or `RecordMapView` (`db.stems`,
 * `db.lemmaHash`, `db.prefixCatHash`, ...): the test-facing accessor the tests
 * read to confirm that the Lexicon leaves the memo as it was. Internal: never
 * exported from `index.ts`.
 *
 * @throws {TypeError} If `view` is not one of those Views.
 */
export function entryMemoOf(view: object): EntryMemo {
  const memo = entryViewMemo(view) ?? recordViewMemo(view);
  if (memo === undefined) {
    throw new TypeError('not an entry or record View');
  }
  return memo;
}

/** Surface (or lemma) → entries: `prefixes`, `suffixes`, `stems`, `lemmaHash`. */
export class EntryMapView implements ReadonlyMap<string, readonly Entry[]> {
  static {
    entryViewMemo = (view) => (#memo in view ? view.#memo : undefined);
  }

  readonly #memo: EntryMemo;
  readonly #table: TableName;
  readonly #index: KeyIndex | null;
  readonly #arrays: (readonly Entry[] | undefined)[] = [];

  constructor(memo: EntryMemo, table: TableName, index: KeyIndex | null) {
    this.#memo = memo;
    this.#table = table;
    this.#index = index;
  }

  get size(): number {
    return this.#index?.slots.size ?? 0;
  }

  get(key: string): readonly Entry[] | undefined {
    const slot = this.#index?.slots.get(key);
    return slot === undefined ? undefined : this.#at(slot);
  }

  has(key: string): boolean {
    return this.#index?.slots.has(key) ?? false;
  }

  forEach(
    callback: (value: readonly Entry[], key: string, map: ReadonlyMap<string, readonly Entry[]>) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this.entries()) {
      callback.call(thisArg, value, key, this);
    }
  }

  entries(): Generator<[string, readonly Entry[]], undefined, unknown> {
    return this.#walk();
  }

  keys(): Generator<string, undefined, unknown> {
    return keysOf(this.#walk());
  }

  values(): Generator<readonly Entry[], undefined, unknown> {
    return valuesOf(this.#walk());
  }

  [Symbol.iterator](): Generator<[string, readonly Entry[]], undefined, unknown> {
    return this.entries();
  }

  *#walk(): Generator<[string, readonly Entry[]], undefined, unknown> {
    if (this.#index === null) {
      return undefined;
    }
    for (const [key, slot] of this.#index.slots) {
      yield [key, this.#at(slot)];
    }
    return undefined;
  }

  #at(slot: number): readonly Entry[] {
    let entries = this.#arrays[slot];
    if (entries === undefined) {
      const index = this.#index as KeyIndex;
      entries = Object.freeze(Array.from(slotIds(index, slot), (id) => this.#memo.entry(this.#table, id)));
      this.#arrays[slot] = entries;
    }
    return entries;
  }
}

/** Category → its lines' feature records: `prefixCatHash`, `suffixCatHash`. */
export class RecordMapView implements ReadonlyMap<string, readonly Readonly<Record<string, string>>[]> {
  static {
    recordViewMemo = (view) => (#memo in view ? view.#memo : undefined);
  }

  readonly #model: TupleModel;
  readonly #memo: EntryMemo;
  readonly #table: TableName;
  readonly #index: IdIndex | null;
  readonly #role: CategoryRole;
  readonly #arrays: (readonly Readonly<Record<string, string>>[] | undefined)[] = [];
  readonly #filled: number;

  constructor(model: TupleModel, memo: EntryMemo, table: TableName, index: IdIndex | null) {
    this.#model = model;
    this.#memo = memo;
    this.#table = table;
    this.#index = index;
    this.#role = roleOf(model, table);
    let filled = 0;
    if (index !== null) {
      for (let slot = 0; slot + 1 < index.start.length; slot++) {
        if ((index.start[slot + 1] as number) > (index.start[slot] as number)) {
          filled++;
        }
      }
    }
    this.#filled = filled;
  }

  get size(): number {
    return this.#filled;
  }

  get(key: string): readonly Readonly<Record<string, string>>[] | undefined {
    const slot = this.#slotOf(key);
    return slot === -1 ? undefined : this.#at(slot);
  }

  has(key: string): boolean {
    return this.#slotOf(key) !== -1;
  }

  forEach(
    callback: (
      value: readonly Readonly<Record<string, string>>[],
      key: string,
      map: ReadonlyMap<string, readonly Readonly<Record<string, string>>[]>,
    ) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this.entries()) {
      callback.call(thisArg, value, key, this);
    }
  }

  entries(): Generator<[string, readonly Readonly<Record<string, string>>[]], undefined, unknown> {
    return this.#walk();
  }

  keys(): Generator<string, undefined, unknown> {
    return keysOf(this.#walk());
  }

  values(): Generator<readonly Readonly<Record<string, string>>[], undefined, unknown> {
    return valuesOf(this.#walk());
  }

  [Symbol.iterator](): Generator<[string, readonly Readonly<Record<string, string>>[]], undefined, unknown> {
    return this.entries();
  }

  // Role ids are assigned first over this side's entry lines, so walking the
  // ids in order and skipping empty slots gives the categories in the order
  // their first line names them.
  *#walk(): Generator<[string, readonly Readonly<Record<string, string>>[]], undefined, unknown> {
    const index = this.#index;
    if (index === null) {
      return undefined;
    }
    const strings = this.#model.strings.strings;
    for (let slot = 0; slot + 1 < index.start.length; slot++) {
      if ((index.start[slot + 1] as number) > (index.start[slot] as number)) {
        yield [strings[this.#role.names[slot] as number] as string, this.#at(slot)];
      }
    }
    return undefined;
  }

  #slotOf(key: string): number {
    const index = this.#index;
    const slot = this.#role.ids.get(key);
    if (index === null || slot === undefined || slot + 1 >= index.start.length) {
      return -1;
    }
    return (index.start[slot + 1] as number) > (index.start[slot] as number) ? slot : -1;
  }

  #at(slot: number): readonly Readonly<Record<string, string>>[] {
    let records = this.#arrays[slot];
    if (records === undefined) {
      records = Object.freeze(
        Array.from(slotIds(this.#index as IdIndex, slot), (id) => this.#memo.entry(this.#table, id).features),
      );
      this.#arrays[slot] = records;
    }
    return records;
  }
}

/** Category → compatible categories, in table-line order: the four compatibility tables. */
export class CompatMapView implements ReadonlyMap<string, ReadonlySet<string>> {
  readonly #model: TupleModel;
  readonly #order: PairOrder;
  readonly #left: CategoryRole;
  readonly #right: CategoryRole;
  readonly #sets: (FrozenSet<string> | undefined)[] = [];

  constructor(model: TupleModel, order: PairOrder, left: CategoryRole, right: CategoryRole) {
    this.#model = model;
    this.#order = order;
    this.#left = left;
    this.#right = right;
  }

  get size(): number {
    return this.#order.rows.length;
  }

  get(key: string): ReadonlySet<string> | undefined {
    const row = this.#rowOf(key);
    return row === -1 ? undefined : this.#at(row);
  }

  has(key: string): boolean {
    return this.#rowOf(key) !== -1;
  }

  forEach(
    callback: (value: ReadonlySet<string>, key: string, map: ReadonlyMap<string, ReadonlySet<string>>) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this.entries()) {
      callback.call(thisArg, value, key, this);
    }
  }

  entries(): Generator<[string, ReadonlySet<string>], undefined, unknown> {
    return this.#walk();
  }

  keys(): Generator<string, undefined, unknown> {
    return keysOf(this.#walk());
  }

  values(): Generator<ReadonlySet<string>, undefined, unknown> {
    return valuesOf(this.#walk());
  }

  [Symbol.iterator](): Generator<[string, ReadonlySet<string>], undefined, unknown> {
    return this.entries();
  }

  *#walk(): Generator<[string, ReadonlySet<string>], undefined, unknown> {
    const strings = this.#model.strings.strings;
    for (let row = 0; row < this.#order.rows.length; row++) {
      yield [strings[this.#left.names[this.#order.rows[row] as number] as number] as string, this.#at(row)];
    }
    return undefined;
  }

  #rowOf(key: string): number {
    const id = this.#left.ids.get(key);
    return id === undefined || id >= this.#order.rowOf.length ? -1 : (this.#order.rowOf[id] as number);
  }

  #at(row: number): FrozenSet<string> {
    let set = this.#sets[row];
    if (set === undefined) {
      const strings = this.#model.strings.strings;
      const ids = this.#order.ids.subarray(this.#order.start[row], this.#order.start[row + 1]);
      set = new FrozenSet(Array.from(ids, (id) => strings[this.#right.names[id] as number] as string));
      this.#sets[row] = set;
    }
    return set;
  }
}

function* keysOf<K, V>(entries: Iterator<[K, V]>): Generator<K, undefined, unknown> {
  for (let next = entries.next(); next.done !== true; next = entries.next()) {
    yield next.value[0];
  }
  return undefined;
}

function* valuesOf<K, V>(entries: Iterator<[K, V]>): Generator<V, undefined, unknown> {
  for (let next = entries.next(); next.done !== true; next = entries.next()) {
    yield next.value[1];
  }
  return undefined;
}
