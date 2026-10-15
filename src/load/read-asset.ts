// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Reading an Asset, and `loadDatabase`: the browser variant.
// `readAsset(source, options)` reads the Manifest, then the Shards it names,
// in parallel, and returns Asset_Bytes in fresh buffers that a caller may
// cache, transfer or open more than once. `loadDatabase(source, options)` is
// `openAsset(await readAsset(source, options), options)`.
//
// How a source resolves:
//
// - A reader function is called with `'manifest.json'`, then with each Shard
//   path, and the `signal`. It is how a caller serves an Asset from
//   IndexedDB, a bundler's asset URLs or anything else.
// - A string or `URL`: a relative string resolves against
//   `globalThis.location` where there is one, and throws `TypeError` where
//   there is none. A URL whose path ends in `.json` names the Manifest; any
//   other names the Asset's directory (a missing trailing `/` is added) and
//   the Manifest is `manifest.json` in it. Shard paths resolve against the
//   Manifest's URL, and every read is `fetch(url, { signal })`.
//
// The Manifest is read first. Where `manifestSha256` is given, its bytes are
// checked against it before they are parsed or any Shard is requested, so a
// tampered Manifest can neither fail as a format error nor direct a request
// (`AssetIntegrityError`, `path: 'manifest.json'`). Beyond the pin,
// `readAsset` checks only the Manifest's shape and the path rule: a Shard
// path is a bare file name, so a Manifest cannot send the loader to another
// origin. Integrity is `openAsset`'s job, on every path.
//
// This module and its Node variant are the only ones in the library that may
// make a request, and only the requests the caller's source names: loading
// is the caller's explicit act (VISION, "Content stays on the device").
//
// This is a new-design file: project header only.

import type { MorphologyDb } from '../engine/database.js';

import { MANIFEST_PATH, parseManifest } from './asset-manifest.js';
import { AssetReadError } from './errors.js';
import { type AssetBytes, manifestPin, type OpenOptions, openAsset, pinError } from './open-asset.js';
import { sha256 } from './sha256.js';

/** A caller's reader: the bytes of an Asset file (`manifest.json` or a Shard path). */
export type AssetReader = (path: string, signal?: AbortSignal) => Promise<ArrayBuffer | ArrayBufferView>;

/** Where an Asset is: a URL or its string (in Node, also a path), or a reader. */
export type AssetSource = string | URL | AssetReader;

/** Options for `readAsset`. */
export interface ReadOptions {
  /** Aborts the reads; the promise then rejects with the signal's reason. */
  signal?: AbortSignal;
  /** The SHA-256 of the Manifest the caller expects (the Asset_Digest), 64 hex digits. */
  manifestSha256?: string;
}

/** Options for `loadDatabase`: those of `readAsset` and of `openAsset`. */
export interface LoadOptions extends OpenOptions, ReadOptions {}

/** Reads one Asset file by its Asset path; resolved from a source. */
export type FileReader = (path: string) => Promise<Uint8Array>;

/** `bytes` in a buffer of their own: the same array when it already owns its whole buffer, else a copy. */
export function ownBytes(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer
    ? bytes
    : bytes.slice();
}

/** Rethrow the signal's reason when it has aborted. */
function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason;
  }
}

/** The file reader of a caller's reader function: results copied into fresh buffers. */
export function readerFiles(reader: AssetReader, signal: AbortSignal | undefined): FileReader {
  return async (path) => {
    let value: unknown;
    try {
      value = await reader(path, signal);
    } catch (e) {
      checkAbort(signal);
      throw new AssetReadError(`${path}: the reader failed (${e instanceof Error ? e.message : String(e)})`, path, null, { cause: e });
    }
    checkAbort(signal);
    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value.slice(0));
    }
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
    }
    throw new AssetReadError(`${path}: the reader returned ${typeof value}, not bytes`, path, null);
  };
}

/** The file reader of an Asset at `manifestUrl`: every read a `fetch`. */
export function fetchFiles(manifestUrl: URL, signal: AbortSignal | undefined): FileReader {
  return async (path) => {
    const url = path === MANIFEST_PATH ? manifestUrl : new URL(path, manifestUrl);
    let response: Response;
    let bytes: ArrayBuffer;
    try {
      response = await fetch(url, signal === undefined ? {} : { signal });
    } catch (e) {
      checkAbort(signal);
      throw new AssetReadError(`${path}: fetching ${url.href} failed (${e instanceof Error ? e.message : String(e)})`, path, null, { cause: e });
    }
    if (!response.ok) {
      throw new AssetReadError(`${path}: ${url.href} answered HTTP ${response.status}`, path, response.status);
    }
    try {
      bytes = await response.arrayBuffer();
    } catch (e) {
      checkAbort(signal);
      throw new AssetReadError(`${path}: reading ${url.href} failed (${e instanceof Error ? e.message : String(e)})`, path, response.status, { cause: e });
    }
    return new Uint8Array(bytes);
  };
}

/** The Manifest's URL for an Asset URL: itself when its path ends in `.json`, else `manifest.json` in it as a directory. */
export function manifestUrlOf(url: URL): URL {
  if (url.pathname.endsWith('.json')) {
    return url;
  }
  const dir = new URL(url.href);
  if (!dir.pathname.endsWith('/')) {
    dir.pathname += '/';
  }
  return new URL(MANIFEST_PATH, dir);
}

/** A string or `URL` source as a URL, a relative string resolved against `globalThis.location`. */
function urlOf(source: string | URL): URL {
  if (source instanceof URL) {
    return source;
  }
  const base = (globalThis as { location?: { href?: unknown } }).location?.href;
  try {
    return typeof base === 'string' ? new URL(source, base) : new URL(source);
  } catch {
    throw new TypeError(
      typeof base === 'string'
        ? `readAsset: ${JSON.stringify(source)} is not a URL`
        : `readAsset: ${JSON.stringify(source)} is relative, and there is no page location to resolve it against`,
    );
  }
}

/** Resolves a source to the reader of its files (browser rules). */
function browserFiles(source: AssetSource, signal: AbortSignal | undefined): FileReader {
  if (typeof source === 'function') {
    return readerFiles(source, signal);
  }
  if (typeof source !== 'string' && !(source instanceof URL)) {
    throw new TypeError('readAsset: the source must be a URL, its string, or a reader function');
  }
  return fetchFiles(manifestUrlOf(urlOf(source)), signal);
}

/**
 * Read an Asset with `resolve`'s file reader: the Manifest, the pin, the
 * Manifest's shape and paths, then every Shard in parallel. Shared by both
 * variants.
 */
export async function readAssetWith(
  resolve: (source: AssetSource, signal: AbortSignal | undefined) => FileReader,
  source: AssetSource,
  options: ReadOptions = {},
): Promise<AssetBytes> {
  const pin = manifestPin(options.manifestSha256);
  const signal = options.signal;
  checkAbort(signal);
  const read = resolve(source, signal);
  const manifest = ownBytes(await read(MANIFEST_PATH));
  if (pin !== undefined) {
    const actual = await sha256(manifest);
    if (actual !== pin) {
      throw pinError(pin, actual);
    }
  }
  const { shards } = parseManifest(manifest);
  const stored = await Promise.all(shards.map(async (shard) => [shard.path, ownBytes(await read(shard.path))] as const));
  return { manifest, shards: Object.fromEntries(stored) };
}

/**
 * Read the Asset at `source` into memory: the Manifest, checked against
 * `manifestSha256` when given, then the Shards it names.
 *
 * @throws {AssetReadError} when a read fails, with the file's `path` and the
 *   HTTP `status` or `null`.
 * @throws {AssetIntegrityError} when the Manifest is not `manifestSha256`.
 * @throws {AssetFormatError} when the Manifest is malformed.
 * @throws {TypeError} for a relative URL without a page location, or a
 *   `manifestSha256` that is not 64 hex digits.
 */
export function readAsset(source: AssetSource, options: ReadOptions = {}): Promise<AssetBytes> {
  return readAssetWith(browserFiles, source, options);
}

/**
 * Load the database at `source`: `openAsset(await readAsset(source,
 * options), options)`. It requests the Manifest and the Shards it names, and
 * nothing else.
 */
export async function loadDatabase(source: AssetSource, options: LoadOptions = {}): Promise<MorphologyDb> {
  return openAsset(await readAsset(source, options), options);
}
