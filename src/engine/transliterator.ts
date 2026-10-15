// Ported from CAMeL Tools utils/transliterate.py (version 1.6.0).
// Copyright 2018-2026 New York University Abu Dhabi. MIT License.
// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.
// shanisarf's changes are Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
//
// The marker-aware Transliterator: a wrapper around a CharMapper that leaves
// whitespace- separated tokens carrying a given marker prefix
// untransliterated. It splits the input on `(<marker>\S+)` and reproduces
// upstream's four stripMarkers/ignoreMarkers branches exactly.
//
// Three faithful departures from the upstream module:
//
//   - The marker's whitespace check uses PY_WHITESPACE (code-point semantics),
//     not JavaScript's `\s`, which the port forbids. Python 3's `str` pattern
//     `\s` matches Unicode whitespace, and PY_WHITESPACE is exactly Python's
//     `str.isspace()` set, so the two agree.
//   - The split regex is upstream's `(<marker>\S+)` translated literally with
//     the `u` flag; Python's `\S` under `re.UNICODE` and JavaScript's `\S`
//     with `u` agree for the marker's purpose. The port forbids `\s`/`\S` in a
//     regex, so the split regex carries a single eslint-disable naming this
//     literal translation.
//   - `re.split` with a capturing group keeps the delimiters; JavaScript's
//     `String.prototype.split` with a capturing group does the same, so the
//     split pieces are the same list upstream iterates.

import { CharMapper } from './charmap.js';
import { codePoints, PY_WHITESPACE } from './python-compat.js';

/**
 * Transliterates text through a {@link CharMapper}, leaving whitespace-
 * separated tokens that begin with a marker prefix untransliterated.
 *
 * Construct with a {@link CharMapper} and an optional marker (default
 * `'@@IGNORE@@'`). The marker must be a non-empty string with no whitespace.
 */
export class Transliterator {
  private readonly mapper: CharMapper;

  private readonly marker: string;

  /** The split regex `(<marker>\S+)`, built once from the escaped marker. */
  private readonly markerRe: RegExp;

  /**
   * @param mapper The {@link CharMapper} used for transliteration.
   * @param marker A string prefixed to tokens that must not be
   *   transliterated. Must not contain whitespace. Defaults to `'@@IGNORE@@'`.
   * @throws {TypeError} If `mapper` is not a {@link CharMapper} or `marker` is
   *   not a string.
   * @throws {RangeError} If `marker` is empty or contains whitespace.
   */
  constructor(mapper: CharMapper, marker: string = '@@IGNORE@@') {
    this.mapper = mapper;

    if (!(mapper instanceof CharMapper)) {
      throw new TypeError('Mapper is not a CharMapper instance.');
    }

    if (typeof marker !== 'string') {
      throw new TypeError('Marker is not a string.');
    }

    if (marker === '') {
      // Upstream raises ValueError('Marker is empty.'); the port raises
      // RangeError, the nearest built-in to Python's ValueError for a bad
      // argument value.
      throw new RangeError('Marker is empty.');
    } else if (!containsWhitespace(marker)) {
      this.marker = marker;
    } else {
      throw new RangeError('Marker contains whitespace.');
    }

    // Upstream's split pattern `({}\S+)` with the marker escaped, translated
    // literally. Python's `re.UNICODE | re.MULTILINE` and JavaScript's `u`
    // agree for the marker's purpose; `\S` is upstream's own class and may not
    // be rewritten "equivalently". `\S` is permitted here, not an accident of
    // JavaScript whitespace: it is upstream's transliterate pattern, kept
    // verbatim.
    this.markerRe = new RegExp(`(${escapeRegExp(this.marker)}\\S+)`, 'u');
  }

  /**
   * Transliterate `s`, leaving marked tokens untransliterated.
   *
   * @param s The string to transliterate.
   * @param stripMarkers If `true`, the marker is removed from the output.
   *   Defaults to `false`.
   * @param ignoreMarkers If `true`, marked tokens are transliterated too
   *   (excluding the marker itself). Defaults to `false`.
   * @returns The transliteration of `s`, with the exception of marked tokens.
   */
  transliterate(
    s: string,
    stripMarkers: boolean = false,
    ignoreMarkers: boolean = false,
  ): string {
    const buff: string[] = [];

    // `re.split` with a capturing group keeps the delimiters; the capturing
    // group in `markerRe` means `String.prototype.split` yields the same
    // interleaved list of non-marked and marked pieces upstream iterates.
    const splits = s.split(this.markerRe);
    for (const spl of splits) {
      // JavaScript's split can produce `undefined` for an unmatched optional
      // capture; `markerRe`'s single group is not optional, so every element
      // is a string, but guard to keep the types honest.
      const piece = spl ?? '';
      if (piece.startsWith(this.marker)) {
        if (ignoreMarkers) {
          if (!stripMarkers) {
            buff.push(this.marker);
          }
          buff.push(this.mapper.mapString(dropPrefix(piece, this.marker)));
        } else {
          if (stripMarkers) {
            buff.push(dropPrefix(piece, this.marker));
          } else {
            buff.push(piece);
          }
        }
      } else {
        buff.push(this.mapper.mapString(piece));
      }
    }

    return buff.join('');
  }
}

/**
 * Does `s` contain any Python_Whitespace code point? Stands in for upstream's
 * `re.search(r'\s', marker)`, using PY_WHITESPACE so the port never leans on
 * JavaScript's `\s`.
 */
function containsWhitespace(s: string): boolean {
  for (const cp of s) {
    if (PY_WHITESPACE.has(cp)) {
      return true;
    }
  }
  return false;
}

/**
 * Remove the leading `marker` from `piece`, by code point, as upstream's
 * `spl[len(self._marker):]` does (Python slices by code point). `piece` is
 * known to start with `marker` at the call sites.
 */
function dropPrefix(piece: string, marker: string): string {
  return codePoints(piece).slice(codePoints(marker).length).join('');
}

/**
 * Escape a string for use as a literal in a regular expression, standing in
 * for Python's `re.escape`. Escapes exactly the characters a `u`-mode regex
 * treats specially (plus `-` for inside a class, harmless here), so the
 * marker is matched literally; a bare backslash before an ordinary code point
 * is avoided, which `u` mode would reject as an invalid escape.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\-/]/gu, '\\$&');
}
