// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The String_Table. A model holds each distinct string once: every feature
// name, feature value, category name and surface the parser keeps is interned
// here, and every Map the model keys by string is keyed by the table's copy.
//
// Fresh copies. The parser reads its strings as slices of the source text, and
// V8 keeps a slice of 13 or more code units as a sliced string that pins its
// parent, here the whole 85 MB database. The table therefore never keeps a
// string it was handed: on first sight it stores a copy, built by
// concatenating a character and slicing it off again, which yields a string
// whose characters were copied out of the source. Every later intern of an
// equal string returns that copy. Nothing here uses engine natives or flags;
// what counts is the outcome: once the caller drops the source and a full
// collection runs, the source's memory is freed while the model lives.
//
// The copy is made on first sight rather than at `seal()` (by joining the
// distinct strings and splitting the result). Over the Database_Pin both give
// the same Retained_Memory within 1 MiB, and copying on first sight parses a
// little faster, since the parser can keep each copy as it goes, in one pass,
// where copies made at the end need a second pass that builds every entry
// afterwards.
//
// Ids and the header partition. `intern` hands out provisional ids in
// first-seen order. `seal()` assigns the final ids: first the header strings,
// those first seen before `endHeader()` (the parser calls it at the
// `###STEMS###` marker) and those interned with `internHeader` (category
// names, whichever section first names them), in first-seen order; then
// every other string, in first-seen order. Ids below `headerCount` are
// header strings. A string seen again later keeps its first id.
//
// This is a new-design file: project header only, in the ported-code check's
// exclusions.

/** A sealed table: id → string, every string a fresh copy. */
export interface StringTable {
  /** The distinct strings by id, none referencing the text they were read from. */
  readonly strings: readonly string[];
  /** Ids below this are header strings. */
  readonly headerCount: number;
}

/** What `seal()` returns: the table, and each provisional id's final id. */
export interface SealedStrings extends StringTable {
  /** `remap[provisionalId]` is that string's id in `strings`. */
  readonly remap: Int32Array;
}

/**
 * A copy of `s` that shares no storage with it or with any string it was cut
 * from: `s` plus one character, sliced back to `s`'s length. The
 * concatenation is a new string, and slicing it copies `s`'s characters out
 * of whatever `s` referenced.
 */
export function freshCopy(s: string): string {
  return (s + '\n').slice(0, s.length);
}

/**
 * Builds a {@link StringTable}: intern strings while parsing, then `seal()`
 * for the final ids.
 */
export class StringTableBuilder {
  // An open-addressing hash table over the copies: slot `i` is the pair
  // `slots[2i]` (the hash) and `slots[2i + 1]` (an id, or -1 when empty), so
  // a probe reads one place. It is keyed by a range of any string: a value
  // already interned is found by hashing its characters where they lie, with
  // no slice and no allocation. (A JavaScript Map would need a string key;
  // on V8 a lookup with a sliced key also internalizes it.) `hashes[id]`
  // keeps each id's hash for growing.
  private slots = new Int32Array(2 << 12).fill(-1);
  private hashes = new Uint32Array(1 << 11);
  private readonly copies: string[] = [];
  private header = new Uint8Array(1 << 11);
  private headerOpen = true;

  /** The number of distinct strings interned so far. */
  get size(): number {
    return this.copies.length;
  }

  /**
   * The provisional id of `s`, interning a copy of it on first sight. A
   * string first seen before `endHeader()` is a header string.
   */
  intern(s: string): number {
    return this.internRange(s, 0, s.length);
  }

  /**
   * The provisional id of `source.slice(start, end)`, found without slicing;
   * a copy of it is interned on first sight.
   */
  internRange(source: string, start: number, end: number): number {
    // FNV-1a over the UTF-16 code units.
    let hash = 0x811c9dc5;
    for (let i = start; i < end; i++) {
      hash = Math.imul(hash ^ source.charCodeAt(i), 0x01000193);
    }
    const length = end - start;
    const slots = this.slots;
    const mask = (slots.length >> 1) - 1;
    let slot = hash & mask;
    for (;;) {
      const id = slots[2 * slot + 1] as number;
      if (id === -1) {
        break;
      }
      if (slots[2 * slot] === hash) {
        const copy = this.copies[id] as string;
        if (copy.length === length && source.startsWith(copy, start)) {
          return id;
        }
      }
      slot = (slot + 1) & mask;
    }
    const id = this.add(source.slice(start, end), hash >>> 0);
    slots[2 * slot] = hash;
    slots[2 * slot + 1] = id;
    if (this.copies.length * 4 > slots.length) {
      this.grow();
    }
    return id;
  }

  /** The table's copy of `s`, interning it on first sight. */
  copy(s: string): string {
    return this.copies[this.intern(s)] as string;
  }

  /**
   * The provisional id of `s`, interned as a header string wherever it is
   * first seen (category and feature names).
   */
  internHeader(s: string): number {
    const id = this.intern(s);
    this.header[id] = 1;
    return id;
  }

  /** The table's copy of `s`, interned as a header string wherever it is first seen. */
  copyHeader(s: string): string {
    return this.copies[this.internHeader(s)] as string;
  }

  /** The string with provisional id `id`. */
  string(id: number): string {
    return this.copies[id] as string;
  }

  /** Strings first seen after this call are not header strings. */
  endHeader(): void {
    this.headerOpen = false;
  }

  /**
   * The final table: header strings first, each group in first-seen order.
   * Interning may continue afterwards; a later `seal()` includes it.
   */
  seal(): SealedStrings {
    const n = this.copies.length;
    const remap = new Int32Array(n);
    const strings = new Array<string>(n);
    let next = 0;
    for (let id = 0; id < n; id++) {
      if (this.header[id] === 1) {
        remap[id] = next;
        strings[next++] = this.copies[id] as string;
      }
    }
    const headerCount = next;
    for (let id = 0; id < n; id++) {
      if (this.header[id] !== 1) {
        remap[id] = next;
        strings[next++] = this.copies[id] as string;
      }
    }
    return { strings, headerCount, remap };
  }

  private add(s: string, hash: number): number {
    const id = this.copies.length;
    this.copies.push(freshCopy(s));
    if (id >= this.hashes.length) {
      const hashes = new Uint32Array(this.hashes.length * 2);
      hashes.set(this.hashes);
      this.hashes = hashes;
      const header = new Uint8Array(this.header.length * 2);
      header.set(this.header);
      this.header = header;
    }
    this.hashes[id] = hash;
    this.header[id] = this.headerOpen ? 1 : 0;
    return id;
  }

  // Double the slot table and reinsert every id by its stored hash.
  private grow(): void {
    const slots = new Int32Array(this.slots.length * 2).fill(-1);
    const mask = (slots.length >> 1) - 1;
    for (let id = 0; id < this.copies.length; id++) {
      const hash = this.hashes[id] as number;
      let slot = hash & mask;
      while (slots[2 * slot + 1] !== -1) {
        slot = (slot + 1) & mask;
      }
      slots[2 * slot] = hash | 0;
      slots[2 * slot + 1] = id;
    }
    this.slots = slots;
  }
}
