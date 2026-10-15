// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Opening an Asset. `openAsset(bytes, options)` is pure: it reads nothing but
// its arguments, and it is what the worker host runs. In order:
//
//   1. read the flags with `readDatabaseFlags(flags ?? 'a')`, so an invalid
//      character throws the parser's `InvalidDatabaseFlagError`;
//   2. hash the Manifest and, where `manifestSha256` is given, compare
//      (`AssetIntegrityError` with `path: 'manifest.json'`);
//   3. parse and validate the Manifest;
//   4. for each Shard, in parallel: inflate it, or keep the bytes when they
//      already start with the Container magic; check its length and SHA-256
//      against the Manifest; read its Container, which must hold the part
//      the Manifest gives it;
//   5. decode the model with the flags and the Provenance built from the
//      Manifest and the Asset_Digest.
//
// Nothing is built before every check passes, and no check can be skipped.
// Each Shard_Content is local to its Shard's step, and the Container reader
// copies every Section out of it, so it can be collected as soon as its
// Sections are read.
//
// Each entry binds its own inflate: the browser entry's `openAsset` pipes
// through `DecompressionStream`, and the Node entry's uses `node:zlib`
// (`inflate-node.ts`). The binding is internal, not an option.
//
// This is a new-design file: project header only.

import { type MorphologyDb, type Provenance, readDatabaseFlags } from '../engine/database.js';
import { type DecodedPart, decodeModel } from '../engine/model-codec.js';

import { MANIFEST_PATH, parseManifest, type ShardEntry } from './asset-manifest.js';
import { AssetFormatError, AssetIntegrityError, AssetReadError } from './errors.js';
import { type Inflate, inflate, isContainer } from './inflate.js';
import { sha256 } from './sha256.js';
import { readContainer } from './shard-container.js';

/** An Asset read into memory, before it is opened: the Manifest's bytes, and each Shard's Stored_Bytes by path. */
export interface AssetBytes {
  manifest: Uint8Array;
  shards: Record<string, Uint8Array>;
}

/** Options for `openAsset`. */
export interface OpenOptions {
  /** The database flags, as `parseAlmor` takes them: `a` (the default), `g` or `r`. */
  flags?: string;
  /** The SHA-256 of the Manifest the caller expects, 64 hex digits: the Asset_Digest. */
  manifestSha256?: string;
}

const HEX64 = /^[0-9a-fA-F]{64}$/u;

/**
 * The `manifestSha256` option in lowercase, or `undefined` when not given.
 *
 * @throws {TypeError} when it is given and is not 64 hex digits.
 */
export function manifestPin(pin: unknown): string | undefined {
  if (pin === undefined) {
    return undefined;
  }
  if (typeof pin !== 'string' || !HEX64.test(pin)) {
    throw new TypeError('manifestSha256 must be the SHA-256 of the Manifest as 64 hex digits');
  }
  return pin.toLowerCase();
}

/** The error for a Manifest whose SHA-256 is not the caller's `manifestSha256`. */
export function pinError(expected: string, actual: string): AssetIntegrityError {
  return new AssetIntegrityError(
    `${MANIFEST_PATH}: its SHA-256 is ${actual}, not the expected ${expected}`,
    MANIFEST_PATH,
    expected,
    actual,
  );
}

/**
 * Open the Asset `bytes` with `inflate` (the entries bind it).
 *
 * @throws {InvalidDatabaseFlagError} for a flag other than `a`, `g` or `r`.
 * @throws {AssetIntegrityError} when the Manifest is not `manifestSha256`, or
 *   a Shard's size or SHA-256 is not the Manifest's, or a stream is corrupt.
 * @throws {AssetFormatError} when the Manifest, a Container or a Section is
 *   malformed, naming the file (and the Section).
 * @throws {AssetReadError} when `bytes` lacks a Shard the Manifest names.
 * @throws {TypeError} when `bytes` is not Asset_Bytes, or `manifestSha256`
 *   is not 64 hex digits.
 */
export async function openAssetWith(inflate: Inflate, bytes: AssetBytes, options: OpenOptions = {}): Promise<MorphologyDb> {
  const flags = readDatabaseFlags(options.flags ?? 'a');
  const pin = manifestPin(options.manifestSha256);
  if (
    typeof bytes !== 'object' ||
    bytes === null ||
    !(bytes.manifest instanceof Uint8Array) ||
    typeof bytes.shards !== 'object' ||
    bytes.shards === null
  ) {
    throw new TypeError('openAsset: bytes must be { manifest: Uint8Array, shards: { [path]: Uint8Array } }');
  }

  const assetDigest = await sha256(bytes.manifest);
  if (pin !== undefined && assetDigest !== pin) {
    throw pinError(pin, assetDigest);
  }
  const manifest = parseManifest(bytes.manifest);
  const [header, stem] = await Promise.all(manifest.shards.map((shard) => openShard(inflate, bytes, shard)));

  const provenance: Provenance = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    license: manifest.license,
    credits: manifest.credits,
    disclaimer: manifest.disclaimer,
    citation: manifest.citation,
    source: manifest.source,
    sourceSha256: manifest.sourceSha256,
    sourceBytes: manifest.sourceBytes,
    formatVersion: manifest.formatVersion,
    assetDigest,
  };
  return decodeModel(header as DecodedPart, stem as DecodedPart, flags, provenance);
}

/** One Shard: inflated (or kept), checked against the Manifest, and its Container read. */
async function openShard(inflate: Inflate, bytes: AssetBytes, shard: ShardEntry): Promise<DecodedPart> {
  const { path, size } = shard;
  const stored = Object.prototype.hasOwnProperty.call(bytes.shards, path) ? bytes.shards[path] : undefined;
  if (!(stored instanceof Uint8Array)) {
    throw new AssetReadError(`${path}: the Asset bytes hold no such Shard`, path, null);
  }
  const content = isContainer(stored) ? stored : await inflate(stored, size, path);
  if (content.length !== size) {
    throw new AssetIntegrityError(
      `${path}: the Shard holds ${content.length} bytes, but the Manifest gives ${size}`,
      path,
      String(size),
      String(content.length),
    );
  }
  const actual = await sha256(content);
  if (actual !== shard.sha256) {
    throw new AssetIntegrityError(
      `${path}: its SHA-256 is ${actual}, but the Manifest gives ${shard.sha256}`,
      path,
      shard.sha256,
      actual,
    );
  }
  try {
    return { ...readContainer(content, shard.part), path };
  } catch (e) {
    if (e instanceof AssetFormatError && e.path === null) {
      e.path = path;
      e.message = `${path}: ${e.message}`;
    }
    throw e;
  }
}

/**
 * Open the Asset `bytes` (the browser entry's binding: inflate through
 * `DecompressionStream`). See {@link openAssetWith} for what it checks and
 * throws.
 */
export function openAsset(bytes: AssetBytes, options: OpenOptions = {}): Promise<MorphologyDb> {
  return openAssetWith(inflate, bytes, options);
}
