#!/usr/bin/env python3
# shanisarf parity harness. Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
#
# The Python half of the Canonical_Key. An Analysis is a feature dictionary
# mapping a string key to a string, a number (the three log-probabilities) or
# None. To compare CAMeL Tools' output to the port's, both sides serialize
# each analysis to one string — its Canonical_Key — and sort the list of
# analyses by that string. The two serializers must agree byte for byte, so
# this file and `tests/parity/canonical.ts` are written as a pair and pinned
# to the same committed vector, `fixtures/meta/canonical-vector.json`.
#
# This is a new-design file (the parity generator's own logic, not a port of a
# CAMeL Tools module): project header only, no ported-code notice.
#
# The four rules of the Canonical_Key, and how each side meets it:
#
#   sorted keys          Python sorts by UTF-16 code-unit order (see
#                        `_utf16_order`), to match JavaScript's native string
#                        comparison, NOT Python's own code-point order. The
#                        two differ only once a key holds an astral code
#                        point; feature keys are ASCII today, but the rule is
#                        implemented in full so a future key cannot break it.
#   compact separators   `separators=(',', ':')` — no spaces, like
#                        `JSON.stringify`.
#   non-ASCII unescaped  `ensure_ascii=False` — like `JSON.stringify`, which
#                        leaves non-ASCII through and escapes the same control
#                        set Python does.
#   integral floats      Python's `json` writes a float `-99.0` as "-99.0",
#   without a `.0`       but JavaScript has one number type and writes "-99".
#                        So an integral float is emitted as its integer form,
#                        matching JavaScript's shortest round-trip output.
#
# Known divergence, out of parity by statement: `json.dumps(ensure_ascii=
# False)` does NOT escape U+2028 / U+2029, while ES2019 `JSON.stringify` does.
# A feature value never holds a line terminator (words that would carry one
# into a value are outside parity, and the word-list scan refuses them), so
# this difference cannot bite a real analysis.

import json
from typing import Dict, List, Union

# An Analysis: a feature dictionary. Values are a string, a number (the three
# log-probabilities) or None, exactly as CAMeL Tools emits them.
FeatureValue = Union[str, int, float, None]
Analysis = Dict[str, FeatureValue]


def _canonicalize_numbers(value: FeatureValue) -> FeatureValue:
    """Rewrite an integral float to an int so `json.dumps` drops its `.0`.

    JavaScript has one number type and prints an integral value without a
    fractional part (`-99`, not `-99.0`); Python's `json` prints a `float`
    `-99.0` as "-99.0". Converting an integral `float` to an `int` before
    dumping makes Python write the same bytes. A non-integral float (a real
    log-probability such as -6.71828) is left alone: Python and JavaScript
    both use the shortest round-trip representation, so they already agree.
    `bool` is a subclass of `int` and is left untouched (an Analysis never
    carries one, but the guard keeps the function honest).
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _utf16_order(key: str) -> bytes:
    """A sort key that orders strings by UTF-16 code unit, as JavaScript does.

    JavaScript compares strings by UTF-16 code unit; Python's native `<`
    compares by Unicode code point. The two agree across the BMP but disagree
    once an astral character is involved (a code point at or above U+10000
    sorts after the BMP by code point, but its surrogate pair starts with
    U+D800..U+DBFF, which sorts before BMP characters at or above U+E000).
    Encoding to UTF-16 big-endian and comparing the bytes reproduces the
    UTF-16 code-unit order exactly. `canonicalKey` in the TypeScript half uses
    `JSON.stringify` with sorted keys, whose key order is this same order.
    """
    return key.encode("utf-16-be")


def canonical_key(analysis: Analysis) -> str:
    """Serialize one analysis to its Canonical_Key.

    Keys sorted by UTF-16 code-unit order, compact separators, non-ASCII left
    unescaped, integral floats without a fractional part. The output equals
    the TypeScript `canonicalKey` byte for byte.
    """
    ordered = {
        k: _canonicalize_numbers(analysis[k])
        for k in sorted(analysis.keys(), key=_utf16_order)
    }
    return json.dumps(
        ordered,
        ensure_ascii=False,
        separators=(",", ":"),
        # Keys are already in the intended order; do not let `json` re-sort by
        # Python's code-point order, which would disagree on astral keys.
        sort_keys=False,
    )


def canonical_order(analyses: List[Analysis]) -> List[Analysis]:
    """Sort a list of analyses by their Canonical_Key, keeping duplicates.

    A multiset: CAMeL Tools can emit the same analysis more than once, so
    equal keys are kept, not collapsed (parity-fixtures rule 3).
    Python's `sorted` is stable, and sorting strings by UTF-16 order is a
    total order over the keys, so the result is a well-defined canonical
    ordering shared with the TypeScript `canonicalOrder`.
    """
    return sorted(analyses, key=lambda a: _utf16_order(canonical_key(a)))
