// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The TypeScript half of the Canonical_Key. To compare the port's output to
// CAMeL Tools', both sides serialize each analysis (a feature dictionary of
// strings, numbers and null) to one string and sort by it. This file and
// `tools/parity/canonical.py` must agree byte for byte, so both are pinned to
// `fixtures/meta/canonical-vector.json`. The rules: keys sorted by UTF-16 code
// unit (the Python half sorts by `key.encode('utf-16-be')`); compact
// separators; non-ASCII unescaped (`ensure_ascii=False`); an integral number
// printed as `-99`, never `-99.0` (the Python half rewrites integral floats to
// ints). Known divergence: `JSON.stringify` escapes U+2028/U+2029 and
// `json.dumps` does not; a feature value never holds a line terminator.

/** One feature value: a string, a number, or null, as the analyzer emits. */
export type FeatureValue = string | number | null;

/**
 * An Analysis: a feature dictionary. The key set is data-dependent — whatever the analysis path produced.
 */
export type Analysis = Record<string, FeatureValue>;

/**
 * Serialize one analysis to its Canonical_Key: the JSON of the feature
 * dictionary with keys in UTF-16 code-unit order, compact separators,
 * non-ASCII left unescaped, and integral numbers without a fractional part.
 * The output equals the Python `canonical_key` byte for byte.
 *
 * `JSON.stringify` on an object visits keys in insertion order, so an object
 * is rebuilt with the keys inserted in sorted order. `Array.prototype.sort`
 * with no comparator sorts by UTF-16 code unit, which is the order the Python
 * half mirrors.
 */
export function canonicalKey(analysis: Analysis): string {
  const keys = Object.keys(analysis).sort();
  const ordered: Analysis = {};
  for (const key of keys) {
    ordered[key] = analysis[key] as FeatureValue;
  }
  return JSON.stringify(ordered);
}

/**
 * Sort a list of analyses by their Canonical_Key, keeping duplicates.
 *
 * A multiset: CAMeL Tools can emit the same analysis more than once, so
 * equal keys are kept, not collapsed.
 * The comparison is by UTF-16 code unit (JavaScript's `<` on strings), which
 * is a total order over the keys, matching the Python half's
 * `key.encode('utf-16-be')` comparison. A fresh array is returned; the input
 * is not mutated.
 */
export function canonicalOrder(analyses: readonly Analysis[]): Analysis[] {
  return analyses
    .map((analysis) => ({ analysis, key: canonicalKey(analysis) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((entry) => entry.analysis);
}
