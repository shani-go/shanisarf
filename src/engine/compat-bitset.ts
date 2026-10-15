// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Category roles and Compatibility_Bitsets.
//
// - Roles. Prefix, stem and suffix categories each get their own dense id
//   space (P, S, X), in first-seen order over the entry lines and then the
//   table lines, so a category named only in a table still gets an id. A
//   category string is taken exactly as parsed: an affix category keeps its
//   unstripped text, as upstream keeps it, and then matches no (stripped)
//   table token. Role names are interned into the String_Table's header range.
// - Bitsets. AB is P × S, BC is S × X, AC is P × X, each a `Uint32Array` of
//   `rows × ceil(cols / 32)` words. A row with no pairs is all zeros, so an
//   absent row is empty.
// - Ordered pair lists. Beside each bitset, the table's pairs in line order,
//   deduplicated by first occurrence (a `Set.add` of a pair already present
//   changes nothing), under their rows in first-seen order. They give each
//   row's pairs in insertion order, and they are what the Generator iterates.
//   AB transposed (S → P) is kept the same way when generation is set.
//
// This is a new-design file: project header only, in the ported-code check's
// exclusions.

/** One role's categories: id → name string id, and name → id. */
export interface CategoryRole {
  /** Role id → the String_Table id of its name (below `headerCount`). */
  readonly names: Uint32Array;
  /** Name → role id. */
  readonly ids: ReadonlyMap<string, number>;
}

/** A bit matrix over two roles' ids. */
export interface Bitset {
  readonly rows: number;
  readonly cols: number;
  /** 32-bit words per row. */
  readonly words: number;
  readonly bits: Uint32Array;
}

/**
 * A table's distinct pairs in line order, under their rows in first-seen
 * order: row `r` is left id `rows[r]`, and its right ids, in first-occurrence
 * order, are `ids[start[r] .. start[r + 1])`.
 */
export interface PairOrder {
  /** Row → left role id, in first-seen order. */
  readonly rows: Uint32Array;
  /** Left role id → its row, or -1 when the table never names it on the left. */
  readonly rowOf: Int32Array;
  readonly start: Uint32Array;
  /** Right role ids. */
  readonly ids: Uint32Array;
}

/** Whether `bitset` has the pair `(row, col)`; ids outside the matrix have none. */
export function bitsetHas(bitset: Bitset, row: number, col: number): boolean {
  if (row < 0 || col < 0 || row >= bitset.rows || col >= bitset.cols) {
    return false;
  }
  return (((bitset.bits[row * bitset.words + (col >>> 5)] as number) >>> (col & 31)) & 1) === 1;
}

/** Builds a {@link CategoryRole}, assigning ids in first-seen order. */
export class CategoryRoleBuilder {
  readonly ids = new Map<string, number>();
  private readonly nameIds: number[] = [];

  /**
   * The role id of `name`, assigning the next one on first sight; `nameId`
   * gives the name's provisional string id then (interned as a header
   * string by the caller).
   */
  roleId(name: string, nameId: (name: string) => number): number {
    let id = this.ids.get(name);
    if (id === undefined) {
      id = this.nameIds.length;
      this.nameIds.push(nameId(name));
      this.ids.set(name, id);
    }
    return id;
  }

  /** The number of role ids assigned so far. */
  get size(): number {
    return this.nameIds.length;
  }

  /** The finished role, name ids mapped through `remap` to final string ids. */
  finish(remap: Int32Array): CategoryRole {
    const names = new Uint32Array(this.nameIds.length);
    for (let i = 0; i < names.length; i++) {
      names[i] = remap[this.nameIds[i] as number] as number;
    }
    return { names, ids: this.ids };
  }
}

/** Builds a compatibility table's {@link Bitset} and {@link PairOrder} from pairs added in line order. */
export class PairTableBuilder {
  private readonly rows = new Map<number, number[]>();
  private readonly seen = new Map<number, Set<number>>();

  add(left: number, right: number): void {
    let rights = this.rows.get(left);
    let seen = this.seen.get(left);
    if (rights === undefined || seen === undefined) {
      rights = [];
      seen = new Set();
      this.rows.set(left, rights);
      this.seen.set(left, seen);
    }
    if (!seen.has(right)) {
      seen.add(right);
      rights.push(right);
    }
  }

  /** The bitset over `leftCount × rightCount` ids and the ordered pairs. */
  finish(leftCount: number, rightCount: number): { bitset: Bitset; order: PairOrder } {
    const words = Math.ceil(rightCount / 32);
    const bits = new Uint32Array(leftCount * words);
    const rows = new Uint32Array(this.rows.size);
    const rowOf = new Int32Array(leftCount).fill(-1);
    const start = new Uint32Array(this.rows.size + 1);
    let pairCount = 0;
    for (const rights of this.rows.values()) {
      pairCount += rights.length;
    }
    const ids = new Uint32Array(pairCount);
    let r = 0;
    let k = 0;
    for (const [left, rights] of this.rows) {
      rows[r] = left;
      rowOf[left] = r;
      for (const right of rights) {
        ids[k++] = right;
        const w = left * words + (right >>> 5);
        bits[w] = ((bits[w] as number) | (1 << (right & 31))) >>> 0;
      }
      start[++r] = k;
    }
    return {
      bitset: { rows: leftCount, cols: rightCount, words, bits },
      order: { rows, rowOf, start, ids },
    };
  }
}
