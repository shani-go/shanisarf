// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the asset errors: each class's `instanceof` chain, `name` and
// fields as own enumerable data properties in order, and `cause` as an own
// property that is not enumerable. Their crossing of the worker boundary is
// tested with the protocol (src/worker/protocol.test.ts).

import { describe, expect, it } from 'vitest';

import { DatabaseError, MorphologyError } from '../engine/errors.js';

import { AssetError, AssetFormatError, AssetIntegrityError, AssetReadError, SourceRecordError } from './errors.js';

describe('the asset errors', () => {
  const cause = new TypeError('fetch failed');
  type ErrorClass = abstract new (...args: never[]) => Error;
  const cases: [Error, ErrorClass[], Record<string, unknown>][] = [
    [new AssetError('m'), [AssetError], { name: 'AssetError' }],
    [new AssetReadError('m', 'stems.bin', 503, { cause }), [AssetReadError, AssetError], { name: 'AssetReadError', path: 'stems.bin', status: 503 }],
    [new AssetFormatError('m'), [AssetFormatError, AssetError], { name: 'AssetFormatError', path: null, section: null }],
    [
      new AssetFormatError('m', { path: 'header.bin', section: 'abOrder.ids' }),
      [AssetFormatError, AssetError],
      { name: 'AssetFormatError', path: 'header.bin', section: 'abOrder.ids' },
    ],
    [
      new AssetIntegrityError('m', 'manifest.json', 'e'.repeat(64), 'a'.repeat(64)),
      [AssetIntegrityError, AssetError],
      { name: 'AssetIntegrityError', path: 'manifest.json', expected: 'e'.repeat(64), actual: 'a'.repeat(64) },
    ],
    [new SourceRecordError('m', 'credits'), [SourceRecordError, AssetError], { name: 'SourceRecordError', field: 'credits' }],
  ];

  for (const [error, classes, fields] of cases) {
    it(`${error.name}: its chain, name and fields`, () => {
      for (const Class of [...classes, DatabaseError, MorphologyError, Error]) {
        expect(error).toBeInstanceOf(Class);
      }
      expect(error.message).toBe('m');
      expect(Object.entries(error)).toEqual(Object.entries(fields));
      for (const key of Object.keys(fields)) {
        const d = Object.getOwnPropertyDescriptor(error, key);
        expect(d && 'value' in d && d.enumerable, key).toBe(true);
      }
    });
  }

  it('keeps a wrapped error as its own cause, which is not enumerable', () => {
    const error = new AssetReadError('m', 'manifest.json', null, { cause });
    expect(error.cause).toBe(cause);
    expect(Object.getOwnPropertyDescriptor(error, 'cause')?.enumerable).toBe(false);
    expect(Object.keys(error)).not.toContain('cause');
    expect('cause' in new AssetReadError('m', 'manifest.json', null)).toBe(false);
  });

  it('lets the loader set the path of a format error', () => {
    const error = new AssetFormatError('m', { section: 'strings.text' });
    error.path = 'stems.bin';
    expect(Object.entries(error)).toEqual([['name', 'AssetFormatError'], ['path', 'stems.bin'], ['section', 'strings.text']]);
  });
});
