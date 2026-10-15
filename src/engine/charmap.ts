// Ported from CAMeL Tools utils/charmap.py (version 1.6.0).
// Copyright 2018-2026 New York University Abu Dhabi. MIT License.
// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.
// shanisarf's changes are Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
//
// The CharMapper: maps the code points of a string to other strings through a
// map whose keys are a single code point or a three-code-point range `a-b`.
//
// Two departures from the upstream module, both faithful to its behaviour:
//
//   - Upstream iterates `charmap.keys()` and `for char in s`, which in Python
//     walk code points. Here every key and every character of the input is
//     walked by code point (`for…of`, `codePoints`), never by UTF-16 code
//     unit, so an astral key or an astral input character behaves as upstream
//     does.
//   - `builtin_mapper` reads a JSON file from the package's `charmaps/`
//     directory at run time; the port has no filesystem at analysis time, so
//     `builtinMapper` looks the name up in the generated `BUILTIN_CHARMAPS`
//     registry (built once by tools/gen-charmaps.ts) and constructs a fresh
//     CharMapper from the entry's `{ charMap, default }`.

import { BUILTIN_CHARMAPS } from './charmaps/index.js';
import {
  BuiltinCharMapNotFoundError,
  InvalidCharMapKeyError,
} from './errors.js';
import { codePoints } from './python-compat.js';

/**
 * A map from a single code point or a three-code-point range `a-b` to a string
 * or `null`. This is the shape the CharMapper constructor accepts and the
 * shape the generated built-in maps use for their single-code-point entries.
 */
export type CharMap = Readonly<Record<string, string | null>>;

/**
 * Maps the code points of a Unicode string to other strings.
 *
 * Construct with a map whose keys are a single code point or a three-code-point
 * range `a-b` (with `a` strictly below `b` by code point), whose values are a
 * string or `null` (map the code point to itself), plus an optional `default`
 * (string or `null`) for code points the map does not mention.
 */
export class CharMapper {
  /** The expanded single-code-point map: every range key spread to its members. */
  private readonly charMap: Map<string, string | null>;

  /** The default for code points absent from the map; `null` means identity. */
  private readonly default: string | null;

  /**
   * @param charMap A plain object mapping a single code point or a
   *   three-code-point range `a-b` to a string or `null`.
   * @param defaultValue The value for code points absent from the map, a
   *   string or `null` (identity). Defaults to `null`.
   * @throws {InvalidCharMapKeyError} If a key is neither a single code point
   *   nor a valid `a-b` range (`a` strictly below `b`).
   * @throws {TypeError} If `charMap` is not a plain mapping object, if a key
   *   is not a string, or if a value or `defaultValue` is neither a string nor
   *   `null`.
   */
  constructor(charMap: CharMap, defaultValue: string | null = null) {
    if (!isMapping(charMap)) {
      throw new TypeError(
        `Expected a dictionary like object for charmap, got ${describe(
          charMap,
        )} instead`,
      );
    }

    this.charMap = CharMapper.expandCharMap(charMap);

    if (defaultValue === null || typeof defaultValue === 'string') {
      this.default = defaultValue;
    } else {
      throw new TypeError(
        `Expected a Unicode string or None value for default, got ${describe(
          defaultValue,
        )} instead.`,
      );
    }
  }

  /**
   * Expand a map's range keys into single-code-point entries, validating each
   * key and value as upstream's `_expand_char_map` does.
   *
   * A key of one code point is kept as is; a key of exactly three code points
   * whose middle code point is `-` is a range `a-b` and is spread to every
   * code point from `a` through `b` inclusive, requiring `a` strictly below
   * `b` by code point; any other key is invalid.
   */
  private static expandCharMap(charMap: CharMap): Map<string, string | null> {
    const newMap = new Map<string, string | null>();

    for (const key of Object.keys(charMap)) {
      // Object keys are always strings in JavaScript; the upstream's
      // non-string-key TypeError cannot arise here, so there is nothing to
      // guard. The key's length is measured in code points, not code units.
      const keyPoints = codePoints(key);
      const value = charMap[key];

      if (keyPoints.length === 1) {
        if (value !== null && typeof value !== 'string') {
          throw new TypeError(
            `Expected a Unicode string or None value for key value, got ${describe(
              value,
            )} instead.`,
          );
        }
        newMap.set(key, value);
      } else if (keyPoints.length === 3 && keyPoints[1] === '-') {
        const start = keyPoints[0]!.codePointAt(0)!;
        const end = keyPoints[2]!.codePointAt(0)!;
        if (start >= end) {
          throw new InvalidCharMapKeyError(key, '');
        }
        if (value !== null && typeof value !== 'string') {
          throw new TypeError(
            `Expected a Unicode string or None value for key value, got ${describe(
              value,
            )} instead.`,
          );
        }
        for (let cp = start; cp <= end; cp++) {
          newMap.set(String.fromCodePoint(cp), value);
        }
      } else {
        throw new InvalidCharMapKeyError(
          key,
          'Invalid character or character range',
        );
      }
    }

    return newMap;
  }

  /**
   * Map each code point of `s` to its value in the map, to `default` when the
   * code point is absent, and to itself when the resolved value is `null`.
   *
   * @param s The string to map.
   * @returns A new string with the map applied.
   * @throws {TypeError} If `s` is not a string.
   */
  mapString(s: string): string {
    if (typeof s !== 'string') {
      throw new TypeError(
        `Expected Unicode string as input, got ${describe(s)} instead.`,
      );
    }

    let out = '';
    for (const char of s) {
      const transliteration = this.charMap.has(char)
        ? this.charMap.get(char)!
        : this.default;
      out += transliteration === null ? char : transliteration;
    }

    return out;
  }

  /**
   * Build a fresh CharMapper from one of the twenty-one built-in maps.
   *
   * @param name The built-in map's name.
   * @returns A new CharMapper for the named map.
   * @throws {BuiltinCharMapNotFoundError} If `name` is not a built-in map.
   */
  static builtinMapper(name: string): CharMapper {
    const data = Object.prototype.hasOwnProperty.call(BUILTIN_CHARMAPS, name)
      ? BUILTIN_CHARMAPS[name]
      : undefined;
    if (data === undefined) {
      throw new BuiltinCharMapNotFoundError(
        name,
        `No built in mapping with name '${name}' was found.`,
      );
    }
    return new CharMapper(data.charMap, data.default);
  }
}

/**
 * Reproduce the upstream's `isinstance(charmap, Mapping)` check: accept a plain
 * object usable as a string-keyed map, reject everything the upstream rejects
 * (strings, arrays, numbers, `null`, functions). This is deliberately strict
 * so a caller passing, say, an array gets the same `TypeError` as upstream.
 */
function isMapping(value: unknown): value is CharMap {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  return !Array.isArray(value);
}

/**
 * A short, type-focused description of a value for the `TypeError` messages,
 * standing in for Python's `type(x)`. The messages exist for parity with
 * upstream's wording; their exact text is not asserted.
 */
function describe(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}
