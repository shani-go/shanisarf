// Ported from CAMeL Tools morphology/analyzer.py (version 1.6.0).
// Copyright 2018-2026 New York University Abu Dhabi. MIT License.
// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.
// shanisarf's changes are Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
//
// Prefix/stem/suffix segmentation. The analyzer enumerates every way to cut a
// word into a prefix, a non-empty stem and a suffix, bounded by the database's
// longest prefix and suffix. This is upstream's double loop in
// `Analyzer.analyze`:
//
//   for p in range(0, min(max_prefix_size, len(word) - 1) + 1):
//       prefix = word[:p]
//       for s in range(max(1, len(word) - p - max_suffix_size),
//                      len(word) - p + 1):
//           stem = word[p:p + s]
//           suffix = word[p + s:]
//
// translated literally, with the one systematic change the port applies
// everywhere: upstream's `len`, `word[:p]` and the other slices index code
// *units* in CPython only incidentally — Python indexes code points — so the
// port works over the code-point array of the word (`codePoints`), never
// UTF-16 indices. Arabic is BMP-only, but the Has_Punc and backoff paths
// segment words that may hold astral code points (emoji), and a cut must never
// split one. The cuts are taken at code-point boundaries, expressed as UTF-16
// offsets so each piece is one `slice` of the word, and the three pieces
// reconstitute the surface exactly.
//
// For `n = 0` the outer `range(0, min(..., -1) + 1)` is `range(0, 0)`, which
// yields nothing, so the empty word yields no segmentation — the port matches
// that by returning before the loops. The stem span `s` starts at `max(1,
// ...)`, so the stem is never empty. The enumeration order (prefix outer,
// stem inner; prefixes shortest first, stems shortest first) is
// upstream's, and the analyzer's output order depends on it, so it is kept.

/**
 * One prefix/stem/suffix split of a word. The three strings concatenate back
 * to the original word (over code points), and `stem` is never empty.
 */
export interface Segmentation {
  prefix: string;
  stem: string;
  suffix: string;
}

/**
 * Enumerate every prefix/stem/suffix split of `word`, bounded by `maxPrefix`
 * and `maxSuffix`, in upstream's order.
 *
 * Over the code-point array `w` of length `n`: for `p` from `0` to
 * `min(maxPrefix, n - 1)` inclusive, and for `s` from `max(1, n - p -
 * maxSuffix)` to `n - p` inclusive, yield `(w[0..p), w[p..p+s), w[p+s..n))`
 * joined back to strings. The empty word (`n = 0`) yields nothing, as Python's
 * `range(0, 0)` does. The stem is never empty, and a cut never falls inside an
 * astral code point because the slices are taken over whole code points.
 *
 * A generator, so the analyzer can stop early and never materializes the full
 * list; the order of yields is upstream's.
 */
export function* segments(
  word: string,
  maxPrefix: number,
  maxSuffix: number,
): Generator<Segmentation, void, undefined> {
  // `offsets[i]` is the UTF-16 offset where code point `i` starts, and
  // `offsets[n]` is `word.length`, so `word.slice(offsets[i], offsets[j])` is
  // code points `i..j` joined. The string iterator splits as `codePoints` does.
  const offsets = [0];
  let offset = 0;
  for (const cp of word) {
    offset += cp.length;
    offsets.push(offset);
  }
  const n = offsets.length - 1;

  // The suffix starting at code point `q`, built on first use. Each prefix and
  // suffix string is built once and handed out for every split that shares
  // it, which also lets the analyzer's Map lookups reuse its hash.
  const suffixes: (string | undefined)[] = new Array<string | undefined>(n + 1);

  // Python's `range(0, min(maxPrefix, n - 1) + 1)`: for n = 0 this is
  // `range(0, 0)` and yields nothing, so the empty word has no segmentation.
  const pMax = Math.min(maxPrefix, n - 1);
  for (let p = 0; p <= pMax; p++) {
    const stemStart = offsets[p] as number;
    const prefix = word.slice(0, stemStart);
    // Python's `range(max(1, n - p - maxSuffix), n - p + 1)`: the lower bound
    // of 1 keeps the stem non-empty.
    const sMin = Math.max(1, n - p - maxSuffix);
    const sMax = n - p;
    for (let s = sMin; s <= sMax; s++) {
      const q = p + s;
      const stemEnd = offsets[q] as number;
      let suffix = suffixes[q];
      if (suffix === undefined) {
        suffix = word.slice(stemEnd);
        suffixes[q] = suffix;
      }
      yield { prefix, stem: word.slice(stemStart, stemEnd), suffix };
    }
  }
}

/**
 * The splits `segments` yields whose prefix and whose suffix both have
 * entries, in the same order, without building the others.
 *
 * `prefixSlot` and `suffixSlot` map a surface to its slot, or -1 when it has
 * no entries. Each prefix (`p` from 0 to `min(maxPrefix, n - 1)`) and each
 * suffix (`q` from `max(1, n - maxSuffix)` to `n`, the ends a stem can reach)
 * is looked up at most once per word, the suffixes only when some prefix
 * hits. For each `(p, s)` of `segments`' double loop whose prefix and suffix
 * both hit, `visit` gets the two slots and the stem, the one string built per
 * visit.
 */
export function forEachHitSegment(
  word: string,
  maxPrefix: number,
  maxSuffix: number,
  prefixSlot: (prefix: string) => number,
  suffixSlot: (suffix: string) => number,
  visit: (prefixSlot: number, stem: string, suffixSlot: number) => void,
): void {
  // `offsets[i]` is the UTF-16 offset of code point `i`, as in `segments`.
  const offsets = [0];
  let offset = 0;
  for (const cp of word) {
    offset += cp.length;
    offsets.push(offset);
  }
  const n = offsets.length - 1;
  const pMax = Math.min(maxPrefix, n - 1);
  if (pMax < 0) {
    return;
  }

  const pre = new Int32Array(pMax + 1);
  let anyPrefix = false;
  for (let p = 0; p <= pMax; p++) {
    pre[p] = prefixSlot(word.slice(0, offsets[p]));
    anyPrefix ||= pre[p] !== -1;
  }
  if (!anyPrefix) {
    return;
  }

  // A stem ends at `q = p + s`, which `segments`' bounds keep within
  // `max(1, n - maxSuffix) .. n`.
  const suf = new Int32Array(n + 1).fill(-1);
  for (let q = Math.max(1, n - maxSuffix); q <= n; q++) {
    suf[q] = suffixSlot(word.slice(offsets[q]));
  }

  for (let p = 0; p <= pMax; p++) {
    const ps = pre[p] as number;
    if (ps === -1) {
      continue;
    }
    const stemStart = offsets[p] as number;
    for (let s = Math.max(1, n - p - maxSuffix); s <= n - p; s++) {
      const xs = suf[p + s] as number;
      if (xs !== -1) {
        visit(ps, word.slice(stemStart, offsets[p + s]), xs);
      }
    }
  }
}
