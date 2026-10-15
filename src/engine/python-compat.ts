// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Python string semantics, made explicit. The port must reproduce Python's
// str.strip, str.split, str.split(sep) and text-mode line iteration rather
// than lean on JavaScript's own whitespace definition (String.prototype.trim)
// or the \s escape, which differ from Python's and would silently break
// parity. Every place upstream indexes, slices, measures or iterates a string,
// the port works on code points, so codePoints and pyLen live here too.
//
// This is a new-design file (a Python-semantics helper): project header only,
// no ported-code notice. The upstream `force_unicode` from utils/stringutils
// is moot in TypeScript and is not ported.

/**
 * The 29 code points for which Python's `str.isspace()` is true. The port's
 * `pyStrip` and `pySplit` use exactly this set, never JavaScript's `\s` or
 * `String.prototype.trim`. A unit test pins this constant to Python's own
 * list, emitted to `fixtures/meta/python-whitespace .json` by the parity
 * generator.
 *
 * The members, by code point:
 *   U+0009 CHARACTER TABULATION        (\t)
 *   U+000A LINE FEED                   (\n)
 *   U+000B LINE TABULATION             (\x0b)
 *   U+000C FORM FEED                   (\x0c)
 *   U+000D CARRIAGE RETURN             (\r)
 *   U+001C FILE SEPARATOR
 *   U+001D GROUP SEPARATOR
 *   U+001E RECORD SEPARATOR
 *   U+001F UNIT SEPARATOR
 *   U+0020 SPACE
 *   U+0085 NEXT LINE
 *   U+00A0 NO-BREAK SPACE
 *   U+1680 OGHAM SPACE MARK
 *   U+2000..U+200A  EN QUAD .. HAIR SPACE  (eleven code points)
 *   U+2028 LINE SEPARATOR
 *   U+2029 PARAGRAPH SEPARATOR
 *   U+202F NARROW NO-BREAK SPACE
 *   U+205F MEDIUM MATHEMATICAL SPACE
 *   U+3000 IDEOGRAPHIC SPACE
 */
export const PY_WHITESPACE: ReadonlySet<string> = new Set([
  '\u0009',
  '\u000a',
  '\u000b',
  '\u000c',
  '\u000d',
  '\u001c',
  '\u001d',
  '\u001e',
  '\u001f',
  '\u0020',
  '\u0085',
  '\u00a0',
  '\u1680',
  '\u2000',
  '\u2001',
  '\u2002',
  '\u2003',
  '\u2004',
  '\u2005',
  '\u2006',
  '\u2007',
  '\u2008',
  '\u2009',
  '\u200a',
  '\u2028',
  '\u2029',
  '\u202f',
  '\u205f',
  '\u3000',
]);

/**
 * The code points of a string, as Python iterates it (and as upstream's
 * `len`, `word[:p]`, `for char in s` do). `Array.from` splits on code point,
 * so astral characters stay whole, unlike UTF-16 indexing.
 */
export function codePoints(s: string): string[] {
  return Array.from(s);
}

/**
 * The number of code points in a string, as Python's `len(s)` counts them —
 * not `s.length`, which counts UTF-16 code units.
 */
export function pyLen(s: string): number {
  return codePoints(s).length;
}

/**
 * Python's `str.strip()` with no argument: remove leading and trailing runs
 * of Python_Whitespace. Uses `PY_WHITESPACE`, never `String.prototype.trim`.
 *
 * Scans UTF-16 code units rather than code points: every Python_Whitespace
 * code point is a single BMP code unit and none is a surrogate, so a scan
 * stops at the first unit of an astral pair (or at a lone surrogate) exactly
 * where a code-point scan would stop, and the cuts fall on the same
 * boundaries. An already stripped string is returned as is.
 */
export function pyStrip(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && PY_WHITESPACE.has(s[start] as string)) {
    start++;
  }
  while (end > start && PY_WHITESPACE.has(s[end - 1] as string)) {
    end--;
  }
  return start === 0 && end === s.length ? s : s.slice(start, end);
}

/**
 * Python's `str.split()` with no argument: split on runs of Python_Whitespace
 * and drop empty strings, so leading, trailing and repeated whitespace never
 * yield empty tokens (`'  a  b '.split()` is `['a', 'b']`). The empty string
 * and all-whitespace strings yield `[]`.
 */
export function pySplit(s: string): string[] {
  const result: string[] = [];
  let current = '';
  for (const cp of codePoints(s)) {
    if (PY_WHITESPACE.has(cp)) {
      if (current !== '') {
        result.push(current);
        current = '';
      }
    } else {
      current += cp;
    }
  }
  if (current !== '') {
    result.push(current);
  }
  return result;
}

/**
 * Python's `str.split(sep)` with an explicit separator: a plain split that
 * keeps empty parts (`'a::b'.split(':')` is `['a', '', 'b']`, `':a:'.split
 * (':')` is `['', 'a', '']`). Matches on code points so a multi-code-point
 * separator and astral characters behave as Python does. Python raises on an
 * empty separator; the port never passes one, so this does not special-case
 * it (an empty `sep` would make `String.prototype.split` disagree with
 * Python, and callers must not rely on that).
 */
export function pySplitOn(s: string, sep: string): string[] {
  return s.split(sep);
}

/**
 * Python's text-mode line iteration (universal newlines): split `text` on any
 * of `\r\n`, `\r` or `\n`, treating all three alike, and drop the final empty
 * segment a terminating newline would otherwise leave. `'a\nb\n'` yields
 * `['a', 'b']`, `'a\nb'` yields `['a', 'b']`, `''` yields `[]`. The regex uses
 * only the explicit line terminators, never `\s`.
 */
export function pyLines(text: string): string[] {
  if (text === '') {
    return [];
  }
  const parts = text.split(/\r\n|\r|\n/u);
  if (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

/**
 * Python's `repr()` of a string, as far as upstream's error messages need
 * it: the parse errors interpolate `repr(line)` / `repr(tok)`, and the flag,
 * generator and reinflector errors `repr(flag)`, `repr(feat)`, `repr(val)`.
 * Python prefers single quotes, switching to double quotes only when the
 * string contains a single quote but no double quote, and backslash-escapes
 * the chosen quote, the backslash and the common control characters (`\t`,
 * `\n`, `\r`). `null` prints as `None`, as `repr(None)` does (the generator's
 * `feats.get('pos', None)` for an absent `pos`). It is not a general `repr`:
 * other non-printable code points are passed through unescaped.
 */
export function pyRepr(value: string | null): string {
  if (value === null) {
    return 'None';
  }
  const hasSingle = value.includes("'");
  const hasDouble = value.includes('"');
  const quote = hasSingle && !hasDouble ? '"' : "'";
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll(quote, `\\${quote}`)
    .replaceAll('\t', '\\t')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r');
  return `${quote}${escaped}${quote}`;
}
