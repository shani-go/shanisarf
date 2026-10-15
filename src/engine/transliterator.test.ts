// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the marker-aware Transliterator. Inputs are a small invented
// CharMapper (single-letter mappings), the built-in ar2bw map applied to
// invented single tokens, and database-derived Arabic code points.
import { describe, expect, it } from 'vitest';

import { CharMapper } from './charmap.js';
import { Transliterator } from './transliterator.js';

// An invented, self-contained map: every lowercase ASCII letter uppercases,
// so the transliteration of any marked/unmarked boundary is easy to read.
const upper = new CharMapper({ 'a-z': null }, null);
// Using null values would be identity; instead spell out a tiny alphabet so
// the mapping is visibly non-identity.
const toUpper = new CharMapper({
  f: 'F',
  o: 'O',
  b: 'B',
  a: 'A',
  r: 'R',
  z: 'Z',
});

describe('Transliterator.transliterate — the four marker branches', () => {
  // One marked token (`@@IGNORE@@foo`) beside one unmarked token (`bar`),
  // with a space between them so the split regex `(<marker>\S+)` isolates the
  // marked token. `foo` -> `FOO`, `bar` -> `BAR` under toUpper.
  const t = new Transliterator(toUpper);
  const input = '@@IGNORE@@foo bar';

  it('default (keep marker, do not map the token): leaves the marked token verbatim', () => {
    // stripMarkers = false, ignoreMarkers = false.
    expect(t.transliterate(input)).toBe('@@IGNORE@@foo BAR');
  });

  it('stripMarkers only: removes the marker but still does not map the token', () => {
    // stripMarkers = true, ignoreMarkers = false.
    expect(t.transliterate(input, true, false)).toBe('foo BAR');
  });

  it('ignoreMarkers only: maps the token and keeps the marker', () => {
    // stripMarkers = false, ignoreMarkers = true.
    expect(t.transliterate(input, false, true)).toBe('@@IGNORE@@FOO BAR');
  });

  it('ignoreMarkers + stripMarkers: maps the token and drops the marker', () => {
    // stripMarkers = true, ignoreMarkers = true.
    expect(t.transliterate(input, true, true)).toBe('FOO BAR');
  });
});

describe('Transliterator.transliterate — built-in ar2bw over invented tokens', () => {
  // ar2bw is a database-derived built-in map. The invented single token
  // `كلمة` is five Arabic code points mapping to `klmp` under ar2bw
  // (ك->k, ل->l, م->m, ة->p). It is a lone word, not running text.
  const ar2bw = CharMapper.builtinMapper('ar2bw');
  const t = new Transliterator(ar2bw);
  const word = '\u0643\u0644\u0645\u0629'; // كلمة
  const marked = `@@IGNORE@@${word}`;

  it('default: leaves a marked Arabic token untransliterated', () => {
    expect(t.transliterate(marked)).toBe(marked);
  });

  it('stripMarkers only: strips the marker, leaves the token untransliterated', () => {
    expect(t.transliterate(marked, true, false)).toBe(word);
  });

  it('ignoreMarkers only: transliterates the token, keeps the marker', () => {
    expect(t.transliterate(marked, false, true)).toBe('@@IGNORE@@klmp');
  });

  it('ignoreMarkers + stripMarkers: transliterates the token, drops the marker', () => {
    expect(t.transliterate(marked, true, true)).toBe('klmp');
  });

  it('transliterates an unmarked Arabic token on every call', () => {
    expect(t.transliterate(word)).toBe('klmp');
  });
});

describe('Transliterator.transliterate — mixed and edge inputs', () => {
  const t = new Transliterator(toUpper);

  it('returns the empty string for empty input', () => {
    expect(t.transliterate('')).toBe('');
  });

  it('maps input with no marker at all', () => {
    expect(t.transliterate('foo bar')).toBe('FOO BAR');
  });

  it('handles several marked and unmarked tokens in sequence', () => {
    const input = 'foo @@IGNORE@@bar foo';
    expect(t.transliterate(input)).toBe('FOO @@IGNORE@@bar FOO');
    expect(t.transliterate(input, true, false)).toBe('FOO bar FOO');
    expect(t.transliterate(input, false, true)).toBe('FOO @@IGNORE@@BAR FOO');
    expect(t.transliterate(input, true, true)).toBe('FOO BAR FOO');
  });

  it('honours a custom marker', () => {
    const custom = new Transliterator(toUpper, '##SKIP##');
    const input = '##SKIP##foo bar';
    expect(custom.transliterate(input)).toBe('##SKIP##foo BAR');
    expect(custom.transliterate(input, true, true)).toBe('FOO BAR');
  });

  it('uses the default marker @@IGNORE@@ when none is given', () => {
    const def = new Transliterator(upper);
    // `upper` maps a-z to themselves (identity), so the only observable effect
    // is the marker handling: the marked token is left verbatim by default.
    expect(def.transliterate('@@IGNORE@@foo bar')).toBe('@@IGNORE@@foo bar');
  });
});

describe('Transliterator construction — argument validation', () => {
  it('throws TypeError when the mapper is not a CharMapper', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new Transliterator({} as any)).toThrow(TypeError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new Transliterator(null as any)).toThrow(TypeError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new Transliterator('ar2bw' as any)).toThrow(TypeError);
  });

  it('throws TypeError when the marker is not a string', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new Transliterator(toUpper, 5 as any)).toThrow(TypeError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new Transliterator(toUpper, null as any)).toThrow(TypeError);
  });

  it('rejects an empty marker with a RangeError', () => {
    expect(() => new Transliterator(toUpper, '')).toThrow(RangeError);
  });

  it('rejects a marker containing an ASCII space with a RangeError', () => {
    expect(() => new Transliterator(toUpper, '@@ IGNORE@@')).toThrow(
      RangeError,
    );
  });

  it('rejects a marker containing a tab or newline with a RangeError', () => {
    expect(() => new Transliterator(toUpper, '@@\tIGNORE@@')).toThrow(
      RangeError,
    );
    expect(() => new Transliterator(toUpper, '@@\nIGNORE@@')).toThrow(
      RangeError,
    );
  });

  it('rejects a marker containing a non-ASCII (Unicode) whitespace code point', () => {
    // U+00A0 NO-BREAK SPACE is Python whitespace; the port rejects it via
    // PY_WHITESPACE, not JavaScript \s.
    expect(() => new Transliterator(toUpper, '@@\u00a0IGNORE@@')).toThrow(
      RangeError,
    );
  });

  it('accepts a non-empty marker with no whitespace', () => {
    expect(() => new Transliterator(toUpper, '@@IGNORE@@')).not.toThrow();
    expect(() => new Transliterator(toUpper, '#')).not.toThrow();
  });
});
