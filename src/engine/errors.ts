// Ported from CAMeL Tools morphology/errors.py (version 1.6.0).
// Ported from CAMeL Tools utils/charmap.py (version 1.6.0): the two CharMapper
// exceptions (InvalidCharMapKeyError, BuiltinCharMapNotFoundError).
// Copyright 2018-2026 New York University Abu Dhabi. MIT License.
// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.
// shanisarf's changes are Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
//
// The morphology error classes: the analysis side and the generation side
// (`GeneratorError`, `ReinflectorError` and their feature errors), with the
// hierarchy upstream's class statements give and upstream's messages.
// InvalidCharMapKeyError and BuiltinCharMapNotFoundError come from upstream
// utils/charmap.py, where they subclass ValueError and carry the offending key
// (or map name) alongside a human-readable message; the rest come from
// morphology/errors.py, where they subclass a common MorphologyError.

import { pyRepr } from './python-compat.js';

/**
 * Base class for all morphology errors.
 *
 * The upstream base stores the message on a `msg` attribute and stringifies to
 * it; here the message is carried through the standard `Error.message` and the
 * subclass name is set on `name` so stack traces read correctly.
 */
export class MorphologyError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'MorphologyError';
    // Restore the prototype chain across the Error built-in (see TypeScript
    // "Extending built-ins" guidance) so `instanceof` holds after transpile.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Base class for errors thrown by the database component.
 */
export class DatabaseError extends MorphologyError {
  constructor(msg: string) {
    super(msg);
    this.name = 'DatabaseError';
  }
}

/**
 * Thrown when a database `flags` string carries an unsupported flag.
 *
 * Upstream message: `Invalid flag value <repr(flag)>`.
 */
export class InvalidDatabaseFlagError extends DatabaseError {
  readonly flag: string;

  constructor(flag: string) {
    super(`Invalid flag value ${pyRepr(flag)}`);
    this.name = 'InvalidDatabaseFlagError';
    this.flag = flag;
  }
}

/**
 * Thrown while parsing an ALMOR database file.
 *
 * The caller passes the offending detail; the final message is
 * `Error parsing database (<detail>)`, matching upstream.
 */
export class DatabaseParseError extends DatabaseError {
  constructor(msg: string) {
    super(`Error parsing database (${msg})`);
    this.name = 'DatabaseParseError';
  }
}

/**
 * Class for errors thrown by the analyzer component.
 */
export class AnalyzerError extends MorphologyError {
  constructor(msg: string) {
    super(msg);
    this.name = 'AnalyzerError';
  }
}

// Generator errors.

/**
 * Base class for errors thrown by the generator component.
 */
export class GeneratorError extends MorphologyError {
  constructor(msg: string) {
    super(msg);
    this.name = 'GeneratorError';
  }
}

/**
 * Thrown when a generation request names a feature the database does not
 * define. Upstream message: `Invalid feature <repr(feat)>`.
 */
export class InvalidGeneratorFeature extends GeneratorError {
  constructor(feat: string) {
    super(`Invalid feature ${pyRepr(feat)}`);
    this.name = 'InvalidGeneratorFeature';
  }
}

/**
 * Thrown when a generation request gives a feature a value outside its
 * define, or lacks `pos`. Upstream message: `Invalid value <repr(val)> for
 * feature <repr(feat)>`; an absent value (`None` upstream) is `null` here.
 */
export class InvalidGeneratorFeatureValue extends GeneratorError {
  constructor(feat: string, val: string | null) {
    super(`Invalid value ${pyRepr(val)} for feature ${pyRepr(feat)}`);
    this.name = 'InvalidGeneratorFeatureValue';
  }
}

// Reinflector errors. Upstream's two feature errors subclass ReinflectorError
// but call `GeneratorError.__init__`; that only sets the message, so the class
// hierarchy below is the class statements' and the messages are the
// generator's.

/**
 * Base class for errors thrown by the reinflector component.
 */
export class ReinflectorError extends MorphologyError {
  constructor(msg: string) {
    super(msg);
    this.name = 'ReinflectorError';
  }
}

/**
 * Thrown when a reinflection request names a feature the database does not
 * define. Upstream message: `Invalid feature <repr(feat)>`.
 */
export class InvalidReinflectorFeature extends ReinflectorError {
  constructor(feat: string) {
    super(`Invalid feature ${pyRepr(feat)}`);
    this.name = 'InvalidReinflectorFeature';
  }
}

/**
 * Thrown when a reinflection request gives a feature a value outside its
 * define. Upstream message: `Invalid value <repr(val)> for feature
 * <repr(feat)>`.
 */
export class InvalidReinflectorFeatureValue extends ReinflectorError {
  constructor(feat: string, val: string | null) {
    super(`Invalid value ${pyRepr(val)} for feature ${pyRepr(feat)}`);
    this.name = 'InvalidReinflectorFeatureValue';
  }
}

/**
 * Raised when an invalid key is found in a charmap used to initialize a
 * `CharMapper`. Upstream this subclasses `ValueError`; here it is a plain
 * `Error` that carries the offending `key` and the `message`.
 */
export class InvalidCharMapKeyError extends Error {
  readonly key: unknown;

  constructor(key: unknown, message: string) {
    super(message);
    this.name = 'InvalidCharMapKeyError';
    this.key = key;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Raised when a map name passed to `CharMapper.builtinMapper` is not in the
 * list of built-in maps. Upstream this subclasses `ValueError`; here it is a
 * plain `Error` that carries the `mapName` and the `message`.
 */
export class BuiltinCharMapNotFoundError extends Error {
  readonly mapName: unknown;

  constructor(mapName: unknown, message: string) {
    super(message);
    this.name = 'BuiltinCharMapNotFoundError';
    this.mapName = mapName;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
