// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Character maps decompose by code point: for any built-in map and any string,
// `mapString(s)` equals the concatenation of `mapString` over `s`'s code
// points; a range key `a-b` maps every code point in `[a, b]`; a `null` value
// or `null` default leaves the code point as it was; an invalid key or value
// throws CAMeL Tools' error type; and for any string over `AR_CHARSET`,
// `dediacBw(ar2bw(s)) === ar2bw(dediacAr(s))`. Arbitraries draw from the
// engine's own character sets, so a counterexample is a short word.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CharMapper } from './charmap.js';
import { BUILTIN_CHARMAP_NAMES, BUILTIN_CHARMAPS } from './charmaps/index.js';
import { AR_CHARSET } from './charsets.js';
import { dediacAr, dediacBw } from './dediac.js';
import { BuiltinCharMapNotFoundError, InvalidCharMapKeyError } from './errors.js';
import { codePoints } from './python-compat.js';

const NUM_RUNS = 200;

/** The code points of a set, as an array, for building arbitraries. */
function members(set: ReadonlySet<string>): string[] {
  return [...set];
}

const AR_CHARS = members(AR_CHARSET);

/**
 * The individual code points a built-in map touches: single-code-point keys
 * as themselves and every member of each range key. The registry holds the
 * raw map (range keys included), so we expand ranges here to feed the
 * arbitrary characters the map actually maps.
 */
function mappedCodePoints(name: string): string[] {
  const data = BUILTIN_CHARMAPS[name]!;
  const out = new Set<string>();
  for (const key of Object.keys(data.charMap)) {
    const kp = codePoints(key);
    if (kp.length === 1) {
      out.add(key);
    } else if (kp.length === 3 && kp[1] === '-') {
      const start = kp[0]!.codePointAt(0)!;
      const end = kp[2]!.codePointAt(0)!;
      for (let cp = start; cp <= end; cp++) {
        out.add(String.fromCodePoint(cp));
      }
    }
  }
  return [...out];
}

/**
 * An arbitrary string over a given alphabet of code points, kept short so
 * shrinking yields a small word. A few unmapped characters (ASCII letters,
 * a space, an astral emoji) are mixed in so the `default`/identity paths are
 * exercised too.
 */
function wordOver(alphabet: string[]): fc.Arbitrary<string> {
  const extras = ['x', 'Q', ' ', '7', '\u{1F600}'];
  const pool = [...alphabet, ...extras];
  return fc
    .array(fc.constantFrom(...pool), { minLength: 0, maxLength: 12 })
    .map((chars) => chars.join(''));
}

describe('character maps decompose by code point', () => {
  it('mapString(s) equals the concatenation of mapString over the code points of s, for every built-in map', () => {
    // Draw a map name, then a word over that map's own alphabet, so the body
    // sees characters the map maps as well as unmapped ones.
    const nameAndWord = fc
      .constantFrom(...BUILTIN_CHARMAP_NAMES)
      .chain((name) =>
        wordOver(mappedCodePoints(name)).map((s) => ({ name, s })),
      );
    fc.assert(
      fc.property(nameAndWord, ({ name, s }) => {
        const mapper = CharMapper.builtinMapper(name);
        const whole = mapper.mapString(s);
        const piecewise = codePoints(s)
          .map((cp) => mapper.mapString(cp))
          .join('');
        expect(whole).toBe(piecewise);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a range key a-b maps every code point in [a, b] to the range value', () => {
    fc.assert(
      fc.property(
        // Pick a start code point and a short positive span so a-b is valid.
        fc.integer({ min: 0x20, max: 0x3000 }),
        fc.integer({ min: 1, max: 8 }),
        (start, span) => {
          const end = start + span;
          const a = String.fromCodePoint(start);
          const b = String.fromCodePoint(end);
          const mapper = new CharMapper({ [`${a}-${b}`]: 'R' }, '.');
          // Every code point in [start, end] maps to 'R'.
          for (let cp = start; cp <= end; cp++) {
            expect(mapper.mapString(String.fromCodePoint(cp))).toBe('R');
          }
          // The code point just past the range falls to the default.
          expect(mapper.mapString(String.fromCodePoint(end + 1))).toBe('.');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('a null value and a null default leave each code point as it was', () => {
    fc.assert(
      fc.property(wordOver(AR_CHARS), (s) => {
        // Every code point present maps to null (identity); the default is
        // null (identity) for the rest. The result must equal the input.
        const entries: Record<string, string | null> = {};
        for (const cp of codePoints(s)) {
          entries[cp] = null;
        }
        const mapper = new CharMapper(entries, null);
        expect(mapper.mapString(s)).toBe(s);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('an invalid key or a non-string value throws the CAMeL Tools error type', () => {
    fc.assert(
      fc.property(
        // Keys of length 0, 2, or 3-without-dash, and reversed/empty ranges.
        fc.oneof(
          fc.constant(''),
          fc.constant('ab'),
          fc.constant('abc'),
          fc.constant('a-a'),
          fc.constant('c-a'),
          // A random two-code-point key.
          fc
            .tuple(fc.constantFrom(...AR_CHARS), fc.constantFrom(...AR_CHARS))
            .map(([a, b]) => a + b),
        ),
        (badKey) => {
          expect(() => new CharMapper({ [badKey]: 'X' })).toThrow(
            InvalidCharMapKeyError,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );

    fc.assert(
      fc.property(
        fc.constantFrom(...AR_CHARS),
        // Non-string, non-null values.
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(undefined)),
        (key, badValue) => {
          expect(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            () => new CharMapper({ [key]: badValue as any }),
          ).toThrow(TypeError);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('mapString throws TypeError for a non-string argument', () => {
    const mapper = CharMapper.builtinMapper('ar2bw');
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.object()),
        (notAString) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          expect(() => mapper.mapString(notAString as any)).toThrow(TypeError);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('builtinMapper throws BuiltinCharMapNotFoundError for any name outside the built-in list', () => {
    const known = new Set<string>(BUILTIN_CHARMAP_NAMES);
    fc.assert(
      fc.property(fc.string(), (name) => {
        fc.pre(!known.has(name));
        expect(() => CharMapper.builtinMapper(name)).toThrow(
          BuiltinCharMapNotFoundError,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('dediacBw(ar2bw(s)) equals ar2bw(dediacAr(s)) for any string over AR_CHARSET', () => {
    const ar2bw = CharMapper.builtinMapper('ar2bw');
    fc.assert(
      fc.property(wordOver(AR_CHARS), (s) => {
        const left = dediacBw(ar2bw.mapString(s));
        const right = ar2bw.mapString(dediacAr(s));
        expect(left).toBe(right);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
