// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the String_Table builder: the ids, the copies' values and the
// header partition. Strings are invented.
import { describe, expect, it } from 'vitest';

import { freshCopy, StringTableBuilder } from './string-table.js';

describe('freshCopy', () => {
  it('returns a string equal by value, for empty, short, long, astral and multi-line strings', () => {
    const big = 'x'.repeat(40) + 'كتب';
    for (const s of ['', 'a', 'pos', big, big.slice(3, 30), '\u{1F600}abc', 'a\nb', '\n', 'trailing\n']) {
      expect(freshCopy(s)).toBe(s);
    }
  });
});

describe('StringTableBuilder', () => {
  it('gives equal strings one id, in first-seen order, and a copy equal by value', () => {
    const b = new StringTableBuilder();
    const source = 'noun verb noun adj';
    const [n1, v, n2, a] = source.split(' ') as [string, string, string, string];
    expect([b.intern(n1), b.intern(v), b.intern(n2), b.intern(a)]).toEqual([0, 1, 0, 2]);
    expect(b.size).toBe(3);
    expect(b.copy('verb')).toBe('verb');
    expect(b.string(2)).toBe('adj');
    expect(b.copy('new')).toBe('new');
    expect(b.intern('new')).toBe(3);
  });

  it('seals header strings first: those seen before endHeader() and those marked header later', () => {
    const b = new StringTableBuilder();
    b.intern('DEFINE'); // 0, header
    b.copyHeader('PREF_CAT'); // 1, header
    b.endHeader();
    b.intern('stem-value'); // 2
    b.copyHeader('STEM_CAT'); // 3, a category first named after the boundary
    b.intern('another'); // 4
    b.intern('DEFINE'); // seen again: keeps id 0
    const sealed = b.seal();
    expect(sealed.headerCount).toBe(3);
    expect(sealed.strings).toEqual(['DEFINE', 'PREF_CAT', 'STEM_CAT', 'stem-value', 'another']);
    expect([...sealed.remap]).toEqual([0, 1, 3, 2, 4]);
  });

  it('marks a string header when it was first seen as a value after the boundary', () => {
    const b = new StringTableBuilder();
    b.endHeader();
    b.intern('X'); // first seen as a stem value
    b.copyHeader('X'); // then named as a category
    const sealed = b.seal();
    expect(sealed.headerCount).toBe(1);
    expect(sealed.strings).toEqual(['X']);
  });

  it('seals an empty builder', () => {
    const sealed = new StringTableBuilder().seal();
    expect(sealed.strings).toEqual([]);
    expect(sealed.headerCount).toBe(0);
  });

  it('holds strings with a newline, which only a hand-built model supplies', () => {
    const b = new StringTableBuilder();
    expect(b.copy('two\nlines')).toBe('two\nlines');
    expect(b.seal().strings).toEqual(['two\nlines']);
  });
});
