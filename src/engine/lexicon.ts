// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The Lexicon: lookups by lemma, stem and root over a model's stem table,
// answered from the tuple model and never through the Views, so the Views'
// EntryMemo and the model's Retained_Memory are the same before and after any
// lookup.
//
// - `stem` uses the model's own stem surface index (present: the Lexicon
//   requires analysis) and never builds one.
// - `lemma` uses the model's lemma index under `r`; under `a` it builds one on
//   first use from each entry's stored, already stripped `lex`.
// - `root` builds one on first use from each entry's `root` feature; an entry
//   without one is in no slot.
// - A folded lookup (`fold: true`) uses, per Lookup_Key, a Map from the
//   folded key to the unfolded index's slots whose keys fold to it, built on
//   the first folded lookup of that key; the result is the union of those
//   slots' entries in line order, each entry once.
//
// Every built index has the model's KeyIndex shape and lives on the Lexicon
// instance: dropping the Lexicon frees it, and the model never changes.
// Records are fresh and frozen on every call; nothing is memoized but the
// indexes and the entry-to-surface-slot array.
//
// This is a new-design file: project header only, in the ported-code check's
// exclusions.

import type { MorphologyDb, TupleModel } from './database.js';
import { tupleModelOf } from './database.js';
import { DatabaseError } from './errors.js';
import { KeyIndexBuilder } from './feature-schema.js';
import type { EntryTable, IdArray, KeyIndex } from './feature-schema.js';
import { foldArabicKey } from './key-fold.js';

/** What a lookup is by: the stored `lex`, the entry's surface, or its `root`. */
export type LookupKey = 'lemma' | 'stem' | 'root';

/** Options of a lookup. */
export interface LookupOptions {
  /** Match after the Fold on both sides. Default false. */
  fold?: boolean;
  /** Keep only these features, in Layout order. Default: every feature the entry has. */
  features?: readonly string[];
}

/** One stem entry, fresh and frozen. */
export interface LexiconEntry {
  readonly surface: string;
  readonly category: string;
  readonly features: Readonly<Record<string, string>>;
}

const LOOKUP_KEYS: readonly LookupKey[] = ['lemma', 'stem', 'root'];

function checkKey(key: unknown): asserts key is string {
  if (typeof key !== 'string') {
    throw new TypeError(`a lookup key must be a string, got ${key === null ? 'null' : typeof key}`);
  }
}

/** The requested feature names as a Set, or null for every feature. */
function featureFilter(options: LookupOptions | undefined): ReadonlySet<string> | null {
  const features = options?.features;
  if (features === undefined) {
    return null;
  }
  if (!Array.isArray(features) || features.some((name) => typeof name !== 'string')) {
    throw new TypeError('options.features must be an array of strings');
  }
  return new Set(features as readonly string[]);
}

/** Whether a lookup folds its key; `fold` must be a boolean when given. */
function foldOption(options: LookupOptions | undefined): boolean {
  const fold = options?.fold;
  if (fold !== undefined && typeof fold !== 'boolean') {
    throw new TypeError('options.fold must be a boolean');
  }
  return fold === true;
}

/** The Key_Indexes a Lexicon holds at the moment it is read; a lazy one is null until built. */
export interface LexiconIndexes {
  readonly stem: KeyIndex;
  readonly lemma: KeyIndex | null;
  readonly root: KeyIndex | null;
  /** Lookup_Key → its folded index (folded key → slots of the unfolded index), once built. */
  readonly folded: ReadonlyMap<LookupKey, ReadonlyMap<string, readonly number[]>>;
}

// The reader `lexiconIndexesOf` uses, set by the class's static block so that
// the indexes stay private fields.
let readIndexes: (lexicon: object) => LexiconIndexes | undefined = () => undefined;

/**
 * The Key_Indexes behind a Lexicon, for tests (they check that `stem`, and
 * `lemma` under `r`, are the model's own objects and that the built ones have
 * the KeyIndex shape). Not exported from the engine entry.
 *
 * @throws {TypeError} If `lexicon` is not a Lexicon.
 */
export function lexiconIndexesOf(lexicon: object): LexiconIndexes {
  const indexes = readIndexes(lexicon);
  if (indexes === undefined) {
    throw new TypeError('not a Lexicon');
  }
  return indexes;
}

/** Answers lookups over a model's stem table without the Views. */
export class Lexicon {
  static {
    readIndexes = (l) =>
      #stemIndex in l
        ? { stem: l.#stemIndex, lemma: l.#lemmaIndex, root: l.#rootIndex, folded: l.#folded }
        : undefined;
  }

  /** The stem table's entry count. */
  readonly size: number;

  readonly #model: TupleModel;
  readonly #table: EntryTable;
  readonly #stemIndex: KeyIndex;
  #lemmaIndex: KeyIndex | null;
  #rootIndex: KeyIndex | null = null;
  readonly #folded = new Map<LookupKey, ReadonlyMap<string, readonly number[]>>();
  /** Entry id → its slot in the stem surface index; built when a record first needs it. */
  #surfaceSlot: Int32Array | null = null;
  /** Stem surface index slot → its key. */
  #surfaceKeys: readonly string[] | null = null;

  constructor(db: MorphologyDb) {
    const model = tupleModelOf(db);
    const stemIndex = model.stem.stemIndex;
    if (!model.header.flags.analysis || stemIndex === null) {
      throw new DatabaseError('DB does not support analysis');
    }
    this.#model = model;
    this.#table = model.stem.stems;
    this.#stemIndex = stemIndex;
    this.#lemmaIndex = model.stem.lemmaIndex;
    this.size = this.#table.count;
  }

  /** The stem entries whose stored (stripped) `lex` is `lemma`, in line order. */
  byLemma(lemma: string, options?: LookupOptions): LexiconEntry[] {
    return this.lookup('lemma', lemma, options);
  }

  /** The stem entries whose surface is `surface`, in line order. */
  byStem(surface: string, options?: LookupOptions): LexiconEntry[] {
    return this.lookup('stem', surface, options);
  }

  /** The stem entries whose `root` feature is `root`, in line order. */
  byRoot(root: string, options?: LookupOptions): LexiconEntry[] {
    return this.lookup('root', root, options);
  }

  /** The stem entries whose `by` key is `key`, in line order. */
  lookup(by: LookupKey, key: string, options?: LookupOptions): LexiconEntry[] {
    if (!LOOKUP_KEYS.includes(by)) {
      throw new TypeError(`unknown lookup key ${JSON.stringify(by)}; expected 'lemma', 'stem' or 'root'`);
    }
    checkKey(key);
    const filter = featureFilter(options);
    const fold = foldOption(options);
    const index = this.#indexOf(by);
    const out: LexiconEntry[] = [];
    if (fold) {
      const slots = this.#foldedOf(by, index).get(foldArabicKey(key));
      if (slots === undefined) {
        return out;
      }
      if (slots.length === 1) {
        this.#pushSlot(out, index, slots[0] as number, filter);
        return out;
      }
      const ids: number[] = [];
      for (const slot of slots) {
        const end = index.start[slot + 1] as number;
        for (let p = index.start[slot] as number; p < end; p++) {
          ids.push(index.ids[p] as number);
        }
      }
      ids.sort((x, y) => x - y);
      let last = -1;
      for (const id of ids) {
        if (id !== last) {
          out.push(this.#record(id, filter));
          last = id;
        }
      }
      return out;
    }
    const slot = index.slots.get(key);
    if (slot !== undefined) {
      this.#pushSlot(out, index, slot, filter);
    }
    return out;
  }

  /**
   * Every stem entry in line order, as fresh records; memoizes none. The
   * options are checked at the call, not on the first `next()`.
   */
  entries(options?: Pick<LookupOptions, 'features'>): IterableIterator<LexiconEntry> {
    return this.#walk(featureFilter(options));
  }

  *#walk(filter: ReadonlySet<string> | null): IterableIterator<LexiconEntry> {
    for (let id = 0; id < this.#table.count; id++) {
      yield this.#record(id, filter);
    }
  }

  #pushSlot(out: LexiconEntry[], index: KeyIndex, slot: number, filter: ReadonlySet<string> | null): void {
    const end = index.start[slot + 1] as number;
    for (let p = index.start[slot] as number; p < end; p++) {
      out.push(this.#record(index.ids[p] as number, filter));
    }
  }

  #indexOf(by: LookupKey): KeyIndex {
    if (by === 'stem') {
      return this.#stemIndex;
    }
    if (by === 'lemma') {
      this.#lemmaIndex ??= this.#buildIndex('lex');
      return this.#lemmaIndex;
    }
    this.#rootIndex ??= this.#buildIndex('root');
    return this.#rootIndex;
  }

  /** A Key_Index over each entry's last value of `feature`, entries without it in no slot. */
  #buildIndex(feature: string): KeyIndex {
    const builder = new KeyIndexBuilder();
    const featureId = this.#model.header.schema.ids.get(feature);
    if (featureId === undefined) {
      return builder.finish();
    }
    const t = this.#table;
    const layouts = this.#model.header.schema.layouts;
    const strings = this.#model.strings.strings;
    // Layout id → the position of `feature` in it (its last one), or -1.
    const at = new Int32Array(layouts.length).fill(-2);
    for (let id = 0; id < t.count; id++) {
      const layout = t.layout[id] as number;
      let p = at[layout] as number;
      if (p === -2) {
        p = lastPosition(layouts[layout] as IdArray, featureId);
        at[layout] = p;
      }
      if (p >= 0) {
        builder.add(strings[t.values[(t.valueStart[id] as number) + p] as number] as string, id);
      }
    }
    return builder.finish();
  }

  #foldedOf(by: LookupKey, index: KeyIndex): ReadonlyMap<string, readonly number[]> {
    let folded = this.#folded.get(by);
    if (folded === undefined) {
      const built = new Map<string, number[]>();
      for (const [key, slot] of index.slots) {
        const k = foldArabicKey(key);
        const slots = built.get(k);
        if (slots === undefined) {
          built.set(k, [slot]);
        } else {
          slots.push(slot);
        }
      }
      folded = built;
      this.#folded.set(by, folded);
    }
    return folded;
  }

  #surfaceOf(id: number): string {
    let slotOf = this.#surfaceSlot;
    let keys = this.#surfaceKeys;
    if (slotOf === null || keys === null) {
      const index = this.#stemIndex;
      slotOf = new Int32Array(this.#table.count).fill(-1);
      const byslot = new Array<string>(index.slots.size);
      for (const [key, slot] of index.slots) {
        byslot[slot] = key;
        const end = index.start[slot + 1] as number;
        for (let p = index.start[slot] as number; p < end; p++) {
          slotOf[index.ids[p] as number] = slot;
        }
      }
      keys = byslot;
      this.#surfaceSlot = slotOf;
      this.#surfaceKeys = keys;
    }
    return keys[slotOf[id] as number] as string;
  }

  /** Entry `id` as a fresh frozen record, its features in Layout order (or the `filter` subset). */
  #record(id: number, filter: ReadonlySet<string> | null): LexiconEntry {
    const model = this.#model;
    const t = this.#table;
    const strings = model.strings.strings;
    const names = model.header.schema.names;
    const keys = model.header.schema.layouts[t.layout[id] as number] as IdArray;
    const base = t.valueStart[id] as number;
    const features: Record<string, string> = {};
    for (let p = 0; p < keys.length; p++) {
      const name = names[keys[p] as number] as string;
      if (filter === null || filter.has(name)) {
        features[name] = strings[t.values[base + p] as number] as string;
      }
    }
    return Object.freeze({
      surface: this.#surfaceOf(id),
      category: strings[model.header.stemCats.names[t.category[id] as number] as number] as string,
      features: Object.freeze(features),
    });
  }
}

/** The last position of `featureId` in `layout`, or -1. */
function lastPosition(layout: IdArray, featureId: number): number {
  for (let p = layout.length - 1; p >= 0; p--) {
    if (layout[p] === featureId) {
      return p;
    }
  }
  return -1;
}
