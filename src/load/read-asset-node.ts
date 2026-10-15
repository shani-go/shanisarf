// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Reading and opening an Asset in Node: the Node entry's `readAsset`,
// `openAsset` and `loadDatabase`. They are the browser variant's, with two
// differences:
//
// - Sources. A `URL` or string with the `file:` scheme is converted with
//   `fileURLToPath`, and any other string that does not parse as an
//   absolute `http:` or `https:` URL is a filesystem path resolved against
//   the working directory; both are read with `node:fs/promises`. The
//   `.json` rule applies as in the browser: a path ending in `.json` is the
//   Manifest, any other is the Asset's directory, and Shard paths resolve
//   against the Manifest's directory. So the `file:` URL string a module
//   resolver gives for `shanisarf-db-msa/asset/manifest.json` (the data
//   package README's example) works as written. `http:` and `https:` go
//   through `fetch` as in the browser.
// - Inflating, with `node:zlib` (`inflate-node.ts`).
//
// This is a new-design file: project header only.

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MorphologyDb } from '../engine/database.js';

import { MANIFEST_PATH } from './asset-manifest.js';
import { AssetReadError } from './errors.js';
import { inflateNode } from './inflate-node.js';
import { type AssetBytes, type OpenOptions, openAssetWith } from './open-asset.js';
import {
  type AssetSource,
  fetchFiles,
  type FileReader,
  type LoadOptions,
  manifestUrlOf,
  type ReadOptions,
  readAssetWith,
  readerFiles,
} from './read-asset.js';

/** The file reader of an Asset on disk, its Manifest at `manifestPath`. */
function diskFiles(manifestPath: string, signal: AbortSignal | undefined): FileReader {
  const dir = dirname(manifestPath);
  return async (path) => {
    const file = path === MANIFEST_PATH ? manifestPath : join(dir, path);
    try {
      const bytes = await readFile(file, signal === undefined ? {} : { signal });
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    } catch (e) {
      if (signal?.aborted === true) {
        throw signal.reason;
      }
      throw new AssetReadError(`${path}: reading ${file} failed (${e instanceof Error ? e.message : String(e)})`, path, null, { cause: e });
    }
  };
}

/** A path source's Manifest path: itself when it ends in `.json`, else `manifest.json` in it. */
function manifestPathOf(path: string): string {
  const absolute = resolve(path);
  return absolute.endsWith('.json') ? absolute : join(absolute, MANIFEST_PATH);
}

/** Resolves a source to the reader of its files (Node rules). */
function nodeFiles(source: AssetSource, signal: AbortSignal | undefined): FileReader {
  if (typeof source === 'function') {
    return readerFiles(source, signal);
  }
  if (source instanceof URL) {
    if (source.protocol === 'file:') {
      return diskFiles(manifestPathOf(fileURLToPath(source)), signal);
    }
    if (source.protocol === 'http:' || source.protocol === 'https:') {
      return fetchFiles(manifestUrlOf(source), signal);
    }
    throw new TypeError(`readAsset: the ${source.protocol} scheme is not one the loader reads (file:, http:, https:)`);
  }
  if (typeof source !== 'string') {
    throw new TypeError('readAsset: the source must be a path, a URL or its string, or a reader function');
  }
  if (source.startsWith('file:')) {
    return diskFiles(manifestPathOf(fileURLToPath(source)), signal);
  }
  let url: URL | null = null;
  try {
    url = new URL(source);
  } catch {
    url = null;
  }
  if (url !== null && (url.protocol === 'http:' || url.protocol === 'https:')) {
    return fetchFiles(manifestUrlOf(url), signal);
  }
  return diskFiles(manifestPathOf(source), signal);
}

/**
 * Read the Asset at `source` into memory (Node: also paths and `file:`
 * URLs). See the browser variant for what it checks and throws.
 */
export function readAsset(source: AssetSource, options: ReadOptions = {}): Promise<AssetBytes> {
  return readAssetWith(nodeFiles, source, options);
}

/**
 * Open the Asset `bytes`, inflating with `node:zlib`. See `openAssetWith`
 * for what it checks and throws.
 */
export function openAsset(bytes: AssetBytes, options: OpenOptions = {}): Promise<MorphologyDb> {
  return openAssetWith(inflateNode, bytes, options);
}

/** Load the database at `source`: `openAsset(await readAsset(source, options), options)`. */
export async function loadDatabase(source: AssetSource, options: LoadOptions = {}): Promise<MorphologyDb> {
  return openAsset(await readAsset(source, options), options);
}
