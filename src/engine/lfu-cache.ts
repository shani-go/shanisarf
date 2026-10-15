// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// A least-frequently-used (LFU) cache with O(1) operations. The analyzer wraps
// `analyze` in one of these when `cacheSize > 0`, keyed by the stripped word.
// The cache changes nothing but speed: it is output-transparent, so for any
// sequence of calls a cached analyzer returns what an uncached one returns.
//
// This is a new-design file (a cache data structure, not a translation of an
// upstream module): project header only, no ported-code notice. Upstream
// uses `cachetools.LFUCache`, a third-party library it imports; the port owns
// its own cache rather than porting that library.
//
// Semantics:
//   - Capacity `capacity` is fixed at construction. A capacity of 0 holds
//     nothing: every `set` is a no-op and every `get` is a miss.
//   - `get(key)` returns the stored value and counts as a use, raising the
//     key's use count by one.
//   - `set(key, value)` stores the value; a fresh key starts at use count 1
//     (its insertion is its first use), as cachetools places a newly set key
//     in the count-1 bucket. Re-setting an existing key replaces the value
//     and raises its count, as a get would.
//   - When a `set` of a new key would exceed capacity, the least-frequently-
//     used entry is evicted first. Among entries at the lowest count, the
//     victim is the one that entered that count's bucket earliest. A new key
//     enters the count-1 bucket last, and a use moves a key to the end of the
//     next count's bucket, so this differs from "oldest insertion" only after
//     promotions. cachetools breaks the tie by pulling an arbitrary member of
//     a Python `set`; the tie-break is never observable through the analyzer's
//     results, only through which array a later hit returns, which the
//     analyzer leaves unspecified.
//
// Structure: nodes `{ key, value, count, prev, next, bucket }` found by key
// through a `Map`; buckets in a doubly linked list in ascending count order,
// each holding its nodes in a doubly linked list in the order they entered
// it. Every operation is O(1).

interface LfuNode<V> {
  readonly key: string;
  value: V;
  count: number;
  prev: LfuNode<V> | null;
  next: LfuNode<V> | null;
  bucket: LfuBucket<V>;
}

interface LfuBucket<V> {
  readonly count: number;
  head: LfuNode<V> | null;
  tail: LfuNode<V> | null;
  prev: LfuBucket<V> | null;
  next: LfuBucket<V> | null;
}

/**
 * A least-frequently-used cache keyed by a string, generic over the stored
 * value type. Holds at most `capacity` entries; when full, a `set` of a new
 * key evicts the least-frequently-used entry, the earliest to enter the
 * lowest count among ties.
 */
export class LfuCache<V> {
  /** The fixed capacity. A capacity of 0 caches nothing. */
  readonly capacity: number;

  private readonly nodes = new Map<string, LfuNode<V>>();

  // The lowest-count bucket, the head of the bucket list; null when empty.
  private lowest: LfuBucket<V> | null = null;

  /**
   * @param capacity the maximum number of entries to retain. Must be a
   *   non-negative integer; a capacity of 0 disables caching.
   */
  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new RangeError(
        `LfuCache capacity must be a non-negative integer, got ${String(capacity)}`,
      );
    }
    this.capacity = capacity;
  }

  /** The number of entries currently held. */
  get size(): number {
    return this.nodes.size;
  }

  /** Whether `key` is currently cached. Does not count as a use. */
  has(key: string): boolean {
    return this.nodes.has(key);
  }

  /**
   * Return the value cached under `key`, or `undefined` on a miss. A hit
   * counts as a use and raises the key's use count by one.
   */
  get(key: string): V | undefined {
    const node = this.nodes.get(key);
    if (node === undefined) {
      return undefined;
    }
    this.touch(node);
    return node.value;
  }

  /**
   * Store `value` under `key`. A new key starts at use count 1; re-setting an
   * existing key replaces its value and raises its count. When storing a new
   * key would exceed capacity, the least-frequently-used entry is evicted
   * first (the earliest to enter the lowest count). A no-op when capacity is
   * 0.
   */
  set(key: string, value: V): void {
    const existing = this.nodes.get(key);
    if (existing !== undefined) {
      // Re-set: replace the value and count the write as a use, as cachetools
      // touches an existing key on __setitem__.
      existing.value = value;
      this.touch(existing);
      return;
    }
    if (this.capacity === 0) {
      return;
    }
    if (this.nodes.size >= this.capacity) {
      this.evict();
    }

    let bucket = this.lowest;
    if (bucket === null || bucket.count !== 1) {
      bucket = { count: 1, head: null, tail: null, prev: null, next: this.lowest };
      if (this.lowest !== null) {
        this.lowest.prev = bucket;
      }
      this.lowest = bucket;
    }
    const node: LfuNode<V> = { key, value, count: 1, prev: null, next: null, bucket };
    append(bucket, node);
    this.nodes.set(key, node);
  }

  /** Remove every entry. */
  clear(): void {
    this.nodes.clear();
    this.lowest = null;
  }

  // A use: move the node to the tail of the bucket for `count + 1`, creating
  // that bucket right after the current one when it is missing, and dropping
  // the current bucket if the move empties it.
  private touch(node: LfuNode<V>): void {
    const from = node.bucket;
    const count = node.count + 1;
    let to = from.next;
    if (to === null || to.count !== count) {
      to = { count, head: null, tail: null, prev: from, next: from.next };
      if (from.next !== null) {
        from.next.prev = to;
      }
      from.next = to;
    }
    detach(node);
    if (from.head === null) {
      this.unlinkBucket(from);
    }
    node.count = count;
    node.bucket = to;
    append(to, node);
  }

  // Remove the head of the lowest bucket: the lowest count, and among those
  // the node that entered the bucket earliest.
  private evict(): void {
    const bucket = this.lowest;
    const victim = bucket?.head ?? null;
    if (bucket === null || victim === null) {
      return;
    }
    detach(victim);
    if (bucket.head === null) {
      this.unlinkBucket(bucket);
    }
    this.nodes.delete(victim.key);
  }

  private unlinkBucket(bucket: LfuBucket<V>): void {
    if (bucket.prev !== null) {
      bucket.prev.next = bucket.next;
    } else {
      this.lowest = bucket.next;
    }
    if (bucket.next !== null) {
      bucket.next.prev = bucket.prev;
    }
    bucket.prev = null;
    bucket.next = null;
  }
}

/** Append `node` at the tail of `bucket`'s node list. */
function append<V>(bucket: LfuBucket<V>, node: LfuNode<V>): void {
  node.prev = bucket.tail;
  node.next = null;
  if (bucket.tail !== null) {
    bucket.tail.next = node;
  } else {
    bucket.head = node;
  }
  bucket.tail = node;
}

/** Unlink `node` from its bucket's node list. */
function detach<V>(node: LfuNode<V>): void {
  const bucket = node.bucket;
  if (node.prev !== null) {
    node.prev.next = node.next;
  } else {
    bucket.head = node.next;
  }
  if (node.next !== null) {
    node.next.prev = node.prev;
  } else {
    bucket.tail = node.prev;
  }
  node.prev = null;
  node.next = null;
}
