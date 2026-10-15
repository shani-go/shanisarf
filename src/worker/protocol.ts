// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The Worker_Host's message protocol and the error crossing.
//
// - Messages. Every request carries an `id` and every reply echoes it, so
//   calls may overlap. A reply carries the host's compute time, or an error
//   in its encoded form.
// - Sources. The host builds its model from ALMOR_Text (as text or bytes), or
//   opens a compiled Asset: the client has read the Asset_Bytes on the
//   caller's thread and transferred them, so the host still makes no request.
//   Its `init` reply carries the model's Provenance, `null` for a parsed
//   model.
// - Lookups. A `lookup` request carries a Lookup_Key, a key and the lookup's
//   options; the reply value is the Lexicon's `LexiconEntry[]`, copied by
//   structured clone. `entries()` does not cross: a walk over every entry
//   would be one reply of the whole Lexicon, so a caller that needs it runs
//   it in-thread.
// - Errors. A thrown error cannot cross structured clone as its class, so the
//   host sends `{ name, message, fields }` and the client rebuilds an
//   instance of the exported class with that name, without calling the
//   class's constructor (the generation errors build their message from
//   their arguments). The instance is an `instanceof` the class and every
//   ancestor, with the same `name`, `message` and fields.
//
// This is a new-design file: project header only.

import type { BackoffMode } from '../engine/analyzer.js';
import type { CharMap } from '../engine/charmap.js';
import type { Provenance } from '../engine/database.js';
import * as engineErrors from '../engine/errors.js';
import type { LookupKey, LookupOptions } from '../engine/lexicon.js';
import * as assetErrors from '../load/errors.js';
import type { AssetBytes } from '../load/open-asset.js';

/** Where the host builds its model from. */
export type Source =
  /** UTF-8 ALMOR_Text. */
  | { kind: 'bytes'; bytes: ArrayBuffer }
  | { kind: 'text'; text: string }
  /** A compiled Asset the client read, opened with `openAsset` and the pin. */
  | { kind: 'asset'; asset: AssetBytes; manifestSha256?: string };

/** The host's reply value to `init`: the model's Provenance, `null` for a parsed model. */
export interface InitResult {
  provenance: Provenance | null;
}

/**
 * The Analyzer's options as they cross to the worker. A `CharMapper` cannot
 * cross structured clone, so `normMap` is `'default'` (the Analyzer's
 * default map), `null` (no normalization) or a `CharMap` specification the
 * host rebuilds with `new CharMapper(charMap, default)`.
 */
export interface WorkerAnalyzerOptions {
  backoff?: BackoffMode;
  strictDigit?: boolean;
  cacheSize?: number;
  normMap?: 'default' | null | { charMap: CharMap; default?: string | null };
}

/** A request from the client. */
export type Request =
  | { id: number; op: 'init'; source: Source; flags: string; analyzer: WorkerAnalyzerOptions }
  | { id: number; op: 'analyze'; word: string }
  | { id: number; op: 'analyzeWords'; words: readonly string[] }
  | { id: number; op: 'generate'; lemma: string; feats: Record<string, string> }
  | { id: number; op: 'reinflect'; word: string; feats: Record<string, string> }
  | { id: number; op: 'allFeats' | 'tokFeats' }
  /** A Lexicon lookup; the reply value is the `LexiconEntry[]`. */
  | { id: number; op: 'lookup'; by: LookupKey; key: string; options?: LookupOptions };

/** An error in the form it crosses in. */
export interface EncodedError {
  name: string;
  message: string;
  /**
   * The error's own enumerable data properties in their order, `name`
   * included where the error holds it itself.
   */
  fields: Record<string, unknown>;
}

/** The host's reply to the request with the same `id`. */
export type Reply =
  | { id: number; ok: true; value: unknown; computeMs: number }
  | { id: number; ok: false; error: EncodedError };

/** A class of error that can be rebuilt on the client side. */
type ErrorClass = new (...args: never[]) => Error;

/**
 * Every error class exported from the engine's `errors.ts` and the loader's
 * (the asset errors), by name, plus the built-in `TypeError`, `RangeError`
 * and `Error`. Built from the modules'
 * exports, so a class added there crosses without a change here.
 */
const ERROR_CLASSES: ReadonlyMap<string, ErrorClass> = new Map<string, ErrorClass>([
  ...Object.entries(engineErrors).filter(([, value]) => isErrorClass(value)) as [string, ErrorClass][],
  ...Object.entries(assetErrors).filter(([, value]) => isErrorClass(value)) as [string, ErrorClass][],
  ['TypeError', TypeError],
  ['RangeError', RangeError],
  ['Error', Error],
]);

function isErrorClass(value: unknown): value is ErrorClass {
  return typeof value === 'function' && (value === Error || value.prototype instanceof Error);
}

/** The names of the classes {@link decodeError} rebuilds (for tests). */
export function errorClassNames(): string[] {
  return [...ERROR_CLASSES.keys()];
}

/**
 * The crossing form of a thrown value: its `name`, its `message`, and its own
 * enumerable data properties in their order: `name` on the exported classes
 * (they set it on the instance), and `flag` on `InvalidDatabaseFlagError`,
 * `key` on `InvalidCharMapKeyError`, `mapName` on
 * `BuiltinCharMapNotFoundError`, and the asset errors' `path`, `status`,
 * `section`, `expected`, `actual` and `field`. An error's `cause` is not
 * enumerable and stays behind; its message carries the text. A field
 * structured clone cannot carry is
 * left out. A thrown non-Error crosses as an `Error` with its string as the
 * message.
 */
export function encodeError(e: unknown): EncodedError {
  if (!(e instanceof Error)) {
    return { name: 'Error', message: String(e), fields: {} };
  }
  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(e)) {
    const descriptor = Object.getOwnPropertyDescriptor(e, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      continue;
    }
    const clone = cloneable(descriptor.value);
    if (clone.ok) {
      fields[key] = clone.value;
    }
  }
  return { name: e.name, message: e.message, fields };
}

/** `value` if structured clone can carry it. */
function cloneable(value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function' && typeof value !== 'symbol')) {
    return { ok: true, value };
  }
  try {
    return { ok: true, value: structuredClone(value) };
  } catch {
    return { ok: false };
  }
}

/**
 * The error an encoded form stands for: an instance of the class whose name
 * matches, made with `Reflect.construct(Error, [message], Class)` so that the
 * class's constructor does not run, with the fields set in the original's
 * order. An unknown name gives a plain `Error` carrying that `name`.
 */
export function decodeError(encoded: EncodedError): Error {
  const Class = ERROR_CLASSES.get(encoded.name) ?? Error;
  const error = Reflect.construct(Error, [encoded.message], Class) as Error;
  // The fields hold `name` where the original held it itself; a built-in
  // inherits it.
  Object.assign(error, encoded.fields);
  if (error.name !== encoded.name) {
    error.name = encoded.name;
  }
  return error;
}
