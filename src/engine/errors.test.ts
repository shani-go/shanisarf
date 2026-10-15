// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the error classes.
import { describe, expect, it } from 'vitest';

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
} from './errors.js';

describe('MorphologyError', () => {
  it('is an Error carrying the message', () => {
    const err = new MorphologyError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MorphologyError);
    expect(err.message).toBe('boom');
    expect(err.name).toBe('MorphologyError');
  });
});

describe('DatabaseError', () => {
  it('extends MorphologyError', () => {
    const err = new DatabaseError('db broke');
    expect(err).toBeInstanceOf(MorphologyError);
    expect(err).toBeInstanceOf(DatabaseError);
    expect(err.message).toBe('db broke');
    expect(err.name).toBe('DatabaseError');
  });
});

describe('InvalidDatabaseFlagError', () => {
  it('extends DatabaseError and quotes the flag like Python repr', () => {
    const err = new InvalidDatabaseFlagError('g');
    expect(err).toBeInstanceOf(DatabaseError);
    expect(err).toBeInstanceOf(MorphologyError);
    expect(err).toBeInstanceOf(InvalidDatabaseFlagError);
    expect(err.flag).toBe('g');
    expect(err.message).toBe("Invalid flag value 'g'");
    expect(err.name).toBe('InvalidDatabaseFlagError');
  });

  it('switches to double quotes when the flag contains a single quote', () => {
    const err = new InvalidDatabaseFlagError("'");
    expect(err.message).toBe('Invalid flag value "\'"');
  });

  it('escapes a backslash in the flag', () => {
    const err = new InvalidDatabaseFlagError('\\');
    expect(err.message).toBe("Invalid flag value '\\\\'");
  });
});

describe('DatabaseParseError', () => {
  it('wraps the detail in the CAMeL Tools message shape', () => {
    const err = new DatabaseParseError("invalid DEFINES line '###'");
    expect(err).toBeInstanceOf(DatabaseError);
    expect(err).toBeInstanceOf(MorphologyError);
    expect(err).toBeInstanceOf(DatabaseParseError);
    expect(err.message).toBe(
      "Error parsing database (invalid DEFINES line '###')",
    );
    expect(err.name).toBe('DatabaseParseError');
  });
});

describe('AnalyzerError', () => {
  it('extends MorphologyError', () => {
    const err = new AnalyzerError('analysis not supported');
    expect(err).toBeInstanceOf(MorphologyError);
    expect(err).toBeInstanceOf(AnalyzerError);
    expect(err.message).toBe('analysis not supported');
    expect(err.name).toBe('AnalyzerError');
  });

  it('is not in the DatabaseError hierarchy', () => {
    const err = new AnalyzerError('x');
    expect(err).not.toBeInstanceOf(DatabaseError);
  });
});

describe('InvalidCharMapKeyError', () => {
  it('carries the key and the message', () => {
    const err = new InvalidCharMapKeyError('a-', 'invalid range');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InvalidCharMapKeyError);
    expect(err.key).toBe('a-');
    expect(err.message).toBe('invalid range');
    expect(err.name).toBe('InvalidCharMapKeyError');
  });

  it('is not a MorphologyError', () => {
    const err = new InvalidCharMapKeyError('x', 'm');
    expect(err).not.toBeInstanceOf(MorphologyError);
  });
});

describe('BuiltinCharMapNotFoundError', () => {
  it('carries the map name and the message', () => {
    const err = new BuiltinCharMapNotFoundError('nope', 'no such map');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BuiltinCharMapNotFoundError);
    expect(err.mapName).toBe('nope');
    expect(err.message).toBe('no such map');
    expect(err.name).toBe('BuiltinCharMapNotFoundError');
  });
});

// The generation-side errors. Class names, hierarchy and messages as printed
// by CAMeL Tools 1.6.0 (morphology/errors.py) for the same arguments.
describe('generation-side errors', () => {
  it('GeneratorError extends MorphologyError and carries the message', () => {
    const err = new GeneratorError('DB does not support generation');
    expect(err).toBeInstanceOf(MorphologyError);
    expect(err.name).toBe('GeneratorError');
    expect(err.message).toBe('DB does not support generation');
  });

  it('InvalidGeneratorFeature quotes the feature', () => {
    const err = new InvalidGeneratorFeature('xyz');
    expect(err).toBeInstanceOf(GeneratorError);
    expect(err.name).toBe('InvalidGeneratorFeature');
    expect(err.message).toBe("Invalid feature 'xyz'");
  });

  it('InvalidGeneratorFeatureValue prints an absent value as None', () => {
    const err = new InvalidGeneratorFeatureValue('pos', null);
    expect(err).toBeInstanceOf(GeneratorError);
    expect(err.name).toBe('InvalidGeneratorFeatureValue');
    expect(err.message).toBe("Invalid value None for feature 'pos'");
  });

  it('InvalidGeneratorFeatureValue quotes a value with a single quote in double quotes', () => {
    const err = new InvalidGeneratorFeatureValue('asp', "it's");
    expect(err.message).toBe(`Invalid value "it's" for feature 'asp'`);
  });

  it('the reinflector errors extend ReinflectorError, not GeneratorError', () => {
    const base = new ReinflectorError('DB does not support reinflection');
    expect(base).toBeInstanceOf(MorphologyError);
    expect(base.name).toBe('ReinflectorError');

    const feat = new InvalidReinflectorFeature('q');
    expect(feat).toBeInstanceOf(ReinflectorError);
    expect(feat).not.toBeInstanceOf(GeneratorError);
    expect(feat.name).toBe('InvalidReinflectorFeature');
    expect(feat.message).toBe("Invalid feature 'q'");

    const val = new InvalidReinflectorFeatureValue('num', 'ANY');
    expect(val).toBeInstanceOf(ReinflectorError);
    expect(val).not.toBeInstanceOf(GeneratorError);
    expect(val.name).toBe('InvalidReinflectorFeatureValue');
    expect(val.message).toBe("Invalid value 'ANY' for feature 'num'");
  });
});
