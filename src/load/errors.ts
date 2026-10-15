// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The asset errors. They subclass the engine's `DatabaseError`, so a caller
// who catches database errors catches these too. Their own fields are
// enumerable data properties, so they cross the worker boundary through the
// worker protocol's error encoding. Where an error wraps another (a rejected
// `fetch`, a failed read), the original is its `cause`: an own property that
// is not enumerable, as `Error`'s own is, so it stays on the calling thread
// and the message carries its text across.
//
// | Error | When |
// |---|---|
// | `AssetReadError` | `fetch` rejected (`status: null`); a status that is not OK; a file that cannot be read; a reader that rejected or returned something that is not bytes |
// | `AssetFormatError` | a Manifest that is not JSON or not a Format_Version the loader reads; a bad field, path or part; a wrong magic; a part mismatch; a malformed Directory or Section; a failed structural check; a big-endian host |
// | `AssetIntegrityError` | a Shard_Content's size or SHA-256 differs; inflating overran or fell short; a corrupt stream; a Manifest that differs from `manifestSha256` |
// | `SourceRecordError` | a Source_Record field missing or malformed; database bytes that do not match the record |
//
// This module imports nothing but the engine's errors, so the Model_Codec may
// throw `AssetFormatError` while the engine still does no I/O.
//
// This is a new-design file: project header only.

import { DatabaseError } from '../engine/errors.js';

/** Options every asset error takes: the error it wraps, if any. */
export interface AssetErrorOptions {
  cause?: unknown;
}

/** Base class of the asset errors. */
export class AssetError extends DatabaseError {
  constructor(message: string, options: AssetErrorOptions = {}) {
    super(message);
    this.name = 'AssetError';
    if ('cause' in options) {
      Object.defineProperty(this, 'cause', {
        value: options.cause,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
  }
}

/**
 * Reading an Asset failed: `fetch` rejected (`status` `null`, the original
 * as `cause`), a response was not OK (`status` is its status), a file could
 * not be read, or a reader rejected or returned something that is not bytes.
 */
export class AssetReadError extends AssetError {
  /** The Asset file being read (`manifest.json` or a Shard path), or the URL. */
  readonly path: string;
  /** The HTTP status, or `null` when there was none. */
  readonly status: number | null;

  constructor(message: string, path: string, status: number | null, options: AssetErrorOptions = {}) {
    super(message, options);
    this.name = 'AssetReadError';
    this.path = path;
    this.status = status;
  }
}

/**
 * An Asset's bytes are not the format: the Manifest, a Container or a
 * Section, or a structural check of the Model_Codec. `path` is the file at
 * fault; the loader sets it on an error the Container reader or the
 * Model_Codec throws, since neither knows file names, and it is `null` only
 * for a big-endian host, which no file causes. `section` names the Section
 * (or a Part_Meta field, as `meta.<field>`) for a Section-level or
 * structural failure, and is `null` otherwise.
 */
export class AssetFormatError extends AssetError {
  path: string | null;
  readonly section: string | null;

  constructor(
    message: string,
    where: { path?: string | null; section?: string | null } = {},
    options: AssetErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'AssetFormatError';
    this.path = where.path ?? null;
    this.section = where.section ?? null;
  }
}

/**
 * An Asset's bytes are not the ones its Manifest (or the caller's
 * `manifestSha256`) names: a size or SHA-256 differs, inflating overran or
 * fell short of the size, or the compressed stream is corrupt.
 */
export class AssetIntegrityError extends AssetError {
  /** The Asset file at fault: `manifest.json` or a Shard path. */
  readonly path: string;
  /** What the Manifest or the caller expected: a size or a SHA-256. */
  readonly expected: string;
  /** What the bytes gave. */
  readonly actual: string;

  constructor(message: string, path: string, expected: string, actual: string, options: AssetErrorOptions = {}) {
    super(message, options);
    this.name = 'AssetIntegrityError';
    this.path = path;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * The compiler's input is wrong: a Source_Record field is missing or
 * malformed, or the database bytes do not match its `sourceBytes` or
 * `sourceSha256`. `field` names the field.
 */
export class SourceRecordError extends AssetError {
  readonly field: string;

  constructor(message: string, field: string, options: AssetErrorOptions = {}) {
    super(message, options);
    this.name = 'SourceRecordError';
    this.field = field;
  }
}
