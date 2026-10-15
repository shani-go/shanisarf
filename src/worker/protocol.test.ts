// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the error crossing of the worker protocol. Each error is
// encoded, carried through structured clone as a reply would be, and decoded.

import { describe, expect, it } from 'vitest';

import * as engineErrors from '../engine/errors.js';
import {
  AnalyzerError,
  BuiltinCharMapNotFoundError,
  DatabaseError,
  DatabaseParseError,
  GeneratorError,
  InvalidCharMapKeyError,
  InvalidDatabaseFlagError,
  InvalidGeneratorFeature,
  InvalidGeneratorFeatureValue,
  InvalidReinflectorFeature,
  InvalidReinflectorFeatureValue,
  MorphologyError,
  ReinflectorError,
} from '../engine/errors.js';

import * as assetErrors from '../load/errors.js';
import {
  AssetError,
  AssetFormatError,
  AssetIntegrityError,
  AssetReadError,
  SourceRecordError,
} from '../load/errors.js';

import { decodeError, encodeError, errorClassNames } from './protocol.js';

/** An error after the trip: encoded, cloned, decoded. */
function cross(error: unknown): Error {
  return decodeError(structuredClone(encodeError(error)));
}

type ErrorClass = new (...args: never[]) => Error;

/** Every constructor on the prototype chain of `error`, up to and including `Error`. */
function ancestors(error: Error): ErrorClass[] {
  const out: ErrorClass[] = [];
  for (let proto = Object.getPrototypeOf(error); proto !== null; proto = Object.getPrototypeOf(proto)) {
    out.push(proto.constructor as ErrorClass);
    if (proto === Error.prototype) {
      break;
    }
  }
  return out;
}

/** One instance of every exported error class, and of the three built-ins. */
const CASES: [string, Error][] = [
  ['MorphologyError', new MorphologyError('boom')],
  ['DatabaseError', new DatabaseError('malformed database')],
  ['InvalidDatabaseFlagError', new InvalidDatabaseFlagError('q')],
  ['DatabaseParseError', new DatabaseParseError('bad line')],
  ['AnalyzerError', new AnalyzerError('Invalid backoff mode XYZ')],
  ['GeneratorError', new GeneratorError('DB does not support generation')],
  ['InvalidGeneratorFeature', new InvalidGeneratorFeature('zz')],
  ['InvalidGeneratorFeatureValue', new InvalidGeneratorFeatureValue('pos', null)],
  ['ReinflectorError', new ReinflectorError('DB does not support reinflection')],
  ['InvalidReinflectorFeature', new InvalidReinflectorFeature('zz')],
  ['InvalidReinflectorFeatureValue', new InvalidReinflectorFeatureValue('num', 'x')],
  ['InvalidCharMapKeyError', new InvalidCharMapKeyError('ab', 'bad key')],
  ['BuiltinCharMapNotFoundError', new BuiltinCharMapNotFoundError('nope', 'no such map')],
  ['AssetError', new AssetError('asset trouble')],
  ['AssetReadError', new AssetReadError('manifest.json: HTTP 404', 'manifest.json', 404, { cause: new Error('x') })],
  ['AssetFormatError', new AssetFormatError('stems.bin, section stems.values: bad', { path: 'stems.bin', section: 'stems.values' })],
  ['AssetIntegrityError', new AssetIntegrityError('header.bin: SHA-256 differs', 'header.bin', 'a'.repeat(64), 'b'.repeat(64))],
  ['SourceRecordError', new SourceRecordError('Source_Record id is not a non-empty string', 'id')],
  ['TypeError', new TypeError('not a MorphologyDb')],
  ['RangeError', new RangeError('capacity must be positive')],
  ['Error', new Error('worker terminated')],
];

describe('the error crossing', () => {
  it('covers every error class errors.ts and the loader\'s errors.ts export, and the three built-ins', () => {
    const exported = Object.entries({ ...engineErrors, ...assetErrors })
      .filter(([, v]) => typeof v === 'function' && v.prototype instanceof Error)
      .map(([name]) => name);
    expect(new Set(errorClassNames())).toEqual(new Set([...exported, 'TypeError', 'RangeError', 'Error']));
    expect(new Set(CASES.map(([name]) => name))).toEqual(new Set(errorClassNames()));
  });

  for (const [name, original] of CASES) {
    it(`${name} crosses as itself: class and ancestors, name, message, fields`, () => {
      const decoded = cross(original);
      expect(Object.getPrototypeOf(decoded)).toBe(Object.getPrototypeOf(original));
      for (const ancestor of ancestors(original)) {
        expect(decoded).toBeInstanceOf(ancestor);
      }
      expect(decoded.name).toBe(original.name);
      expect(decoded.message).toBe(original.message);
      // The same own enumerable properties, in the same order, with the same
      // values (`name` on the exported classes, and each class's fields).
      expect(Object.entries(decoded)).toEqual(Object.entries(original));
    });
  }

  it('keeps the fields: flag, key and mapName', () => {
    expect((cross(new InvalidDatabaseFlagError('q')) as InvalidDatabaseFlagError).flag).toBe('q');
    expect((cross(new InvalidCharMapKeyError('ab', 'm')) as InvalidCharMapKeyError).key).toBe('ab');
    expect((cross(new BuiltinCharMapNotFoundError(7, 'm')) as BuiltinCharMapNotFoundError).mapName).toBe(7);
  });

  it('keeps the asset errors\' fields, and leaves their cause behind', () => {
    const read = cross(new AssetReadError('m', 'stems.bin', null, { cause: new TypeError('fetch failed') })) as AssetReadError;
    expect([read.path, read.status, read.cause]).toEqual(['stems.bin', null, undefined]);
    const format = cross(new AssetFormatError('m', { section: 'layouts.keys' })) as AssetFormatError;
    expect([format.path, format.section]).toEqual([null, 'layouts.keys']);
    const integrity = cross(new AssetIntegrityError('m', 'manifest.json', 'e', 'a')) as AssetIntegrityError;
    expect([integrity.path, integrity.expected, integrity.actual]).toEqual(['manifest.json', 'e', 'a']);
    expect((cross(new SourceRecordError('m', 'license.url')) as SourceRecordError).field).toBe('license.url');
    for (const e of [read, format, integrity]) {
      expect(e).toBeInstanceOf(AssetError);
      expect(e).toBeInstanceOf(DatabaseError);
    }
  });

  it('does not run the class constructor (the message is not rebuilt)', () => {
    const decoded = cross(new InvalidGeneratorFeatureValue('pos', 'x'));
    expect(decoded.message).toBe("Invalid value 'x' for feature 'pos'");
  });

  it('gives a plain Error carrying the name for an unknown class', () => {
    class Unlisted extends Error {
      constructor() {
        super('odd');
        this.name = 'Unlisted';
      }
    }
    const decoded = cross(new Unlisted());
    expect(Object.getPrototypeOf(decoded)).toBe(Error.prototype);
    expect(decoded.name).toBe('Unlisted');
    expect(decoded.message).toBe('odd');
  });

  it('carries a thrown non-Error as an Error with its string', () => {
    const decoded = cross('plain string');
    expect(Object.getPrototypeOf(decoded)).toBe(Error.prototype);
    expect(decoded.message).toBe('plain string');
  });

  it('leaves out a field structured clone cannot carry', () => {
    const odd = new InvalidCharMapKeyError(() => 1, 'odd key');
    const encoded = encodeError(odd);
    expect(encoded.fields).toEqual({ name: 'InvalidCharMapKeyError' });
    expect(() => structuredClone(encoded)).not.toThrow();
  });
});
