// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the CharMapper.
import { describe, expect, it } from 'vitest';

import { CharMapper } from './charmap.js';
import { BUILTIN_CHARMAP_NAMES, BUILTIN_CHARMAPS } from './charmaps/index.js';
import {
  BuiltinCharMapNotFoundError,
  InvalidCharMapKeyError,
} from './errors.js';

describe('CharMapper construction', () => {
  it('accepts single-code-point keys with string values', () => {
    const m = new CharMapper({ a: 'X', b: 'Y' });
    expect(m.mapString('ab')).toBe('XY');
  });

  it('accepts a three-code-point range key a-b with a < b', () => {
    const m = new CharMapper({ 'a-c': 'Z' });
    expect(m.mapString('abc')).toBe('ZZZ');
  });

  it('accepts a null value (identity) and a null default (identity)', () => {
    const m = new CharMapper({ a: null }, null);
    expect(m.mapString('abc')).toBe('abc');
  });

  it('accepts a string default for absent code points', () => {
    const m = new CharMapper({ a: 'X' }, '?');
    expect(m.mapString('abc')).toBe('X??');
  });

  it('defaults the default to null (identity) when omitted', () => {
    const m = new CharMapper({ a: 'X' });
    expect(m.mapString('abc')).toBe('Xbc');
  });

  it('handles astral code points as single keys', () => {
    // U+1F600 is one code point but two UTF-16 code units; it must count as
    // length 1 and map whole.
    const m = new CharMapper({ '\u{1F600}': ':)' });
    expect(m.mapString('x\u{1F600}y')).toBe('x:)y');
  });

  it('handles an astral range key by code point', () => {
    const m = new CharMapper({ '\u{1F600}-\u{1F602}': 'E' });
    expect(m.mapString('\u{1F600}\u{1F601}\u{1F602}')).toBe('EEE');
  });
});

describe('CharMapper key validation', () => {
  it('throws InvalidCharMapKeyError for a two-code-point key', () => {
    expect(() => new CharMapper({ ab: 'X' })).toThrow(InvalidCharMapKeyError);
  });

  it('throws InvalidCharMapKeyError for a length-3 key without a dash middle', () => {
    expect(() => new CharMapper({ abc: 'X' })).toThrow(InvalidCharMapKeyError);
  });

  it('throws InvalidCharMapKeyError when the range is empty (a === b)', () => {
    expect(() => new CharMapper({ 'a-a': 'X' })).toThrow(
      InvalidCharMapKeyError,
    );
  });

  it('throws InvalidCharMapKeyError when the range is reversed (a > b)', () => {
    expect(() => new CharMapper({ 'c-a': 'X' })).toThrow(
      InvalidCharMapKeyError,
    );
  });

  it('carries the offending key on the error', () => {
    try {
      new CharMapper({ 'c-a': 'X' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidCharMapKeyError);
      expect((err as InvalidCharMapKeyError).key).toBe('c-a');
    }
  });
});

describe('CharMapper value and default validation', () => {
  it('throws TypeError for a non-string, non-null single-key value', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new CharMapper({ a: 5 as any })).toThrow(TypeError);
  });

  it('throws TypeError for a non-string, non-null range-key value', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new CharMapper({ 'a-c': 5 as any })).toThrow(TypeError);
  });

  it('throws TypeError for a non-string, non-null default', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new CharMapper({ a: 'X' }, 5 as any)).toThrow(TypeError);
  });

  it('throws TypeError when charMap is not a mapping object', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new CharMapper([] as any)).toThrow(TypeError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new CharMapper('ab' as any)).toThrow(TypeError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new CharMapper(null as any)).toThrow(TypeError);
  });
});

describe('CharMapper.mapString', () => {
  it('maps present code points, defaults absent ones, keeps null as identity', () => {
    const m = new CharMapper({ a: 'A', b: null }, '_');
    // a -> 'A' (present), b -> identity (null value), c -> '_' (default).
    expect(m.mapString('abc')).toBe('Ab_');
  });

  it('returns the empty string for empty input', () => {
    const m = new CharMapper({ a: 'A' });
    expect(m.mapString('')).toBe('');
  });

  it('maps an empty-string value as a deletion', () => {
    const m = new CharMapper({ a: '' });
    expect(m.mapString('abc')).toBe('bc');
  });

  it('throws TypeError for a non-string argument', () => {
    const m = new CharMapper({ a: 'A' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => m.mapString(5 as any)).toThrow(TypeError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => m.mapString(null as any)).toThrow(TypeError);
  });
});

describe('CharMapper.builtinMapper', () => {
  it('returns a working mapper for every built-in name', () => {
    for (const name of BUILTIN_CHARMAP_NAMES) {
      const m = CharMapper.builtinMapper(name);
      expect(m).toBeInstanceOf(CharMapper);
      // mapString works and never throws for an empty string.
      expect(m.mapString('')).toBe('');
    }
  });

  it('returns a fresh instance each call', () => {
    const a = CharMapper.builtinMapper('ar2bw');
    const b = CharMapper.builtinMapper('ar2bw');
    expect(a).not.toBe(b);
  });

  it('produces a mapper consistent with the registry entry', () => {
    // ar2bw maps the Arabic letter alef to the Buckwalter capital A.
    const m = CharMapper.builtinMapper('ar2bw');
    const expected = BUILTIN_CHARMAPS['ar2bw']?.charMap['\u0627'];
    if (typeof expected === 'string') {
      expect(m.mapString('\u0627')).toBe(expected);
    }
  });

  it('throws BuiltinCharMapNotFoundError for an unknown name', () => {
    expect(() => CharMapper.builtinMapper('not-a-map')).toThrow(
      BuiltinCharMapNotFoundError,
    );
  });

  it('carries the offending name on the error', () => {
    try {
      CharMapper.builtinMapper('nope');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BuiltinCharMapNotFoundError);
      expect((err as BuiltinCharMapNotFoundError).mapName).toBe('nope');
    }
  });
});
