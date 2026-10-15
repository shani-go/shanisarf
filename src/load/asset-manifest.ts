// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The Manifest: an Asset's `manifest.json`. It says what the database is,
// where it came from, under which license and with which attribution, and
// names each Shard by part, file name, size and SHA-256, all of the
// Shard_Content (the bytes after inflating), never of the Stored_Bytes, which
// depend on the deflate build and level. It records no compiler, engine or
// package version, so its bytes, and so the Asset_Digest (its SHA-256),
// depend only on the Source_Record, the database and the Format_Version.
//
// It is written as canonical JSON: the key order of `AssetManifest` below,
// two-space indent, `\n` line ends and a final newline. `parseManifest`
// validates every field and rebuilds the record in that order, so a
// canonical Manifest re-serializes to the same bytes.
//
// A Shard `path` is a bare file name (`^[A-Za-z0-9][A-Za-z0-9._-]*$`, not
// `manifest.json`): a Manifest may name files but not locations, so the
// caller's source decides every request.
//
// This is a new-design file: project header only.

import { AssetFormatError } from './errors.js';
import { FORMAT_VERSION, type PartKind } from './shard-container.js';

/** The Manifest's `format`. */
export const MANIFEST_FORMAT = 'shanisarf-asset';

/** The Manifest's file name in an Asset's directory. */
export const MANIFEST_PATH = 'manifest.json';

/** The license an Asset's database is under. */
export interface AssetLicense {
  /** An SPDX identifier, such as `CC-BY-4.0`. */
  id: string;
  /** The license text's URL. */
  url: string;
}

/** One Shard as the Manifest names it. */
export interface ShardEntry {
  part: PartKind;
  /** A bare file name in the Asset's directory. */
  path: string;
  compression: 'deflate';
  /** The Shard_Content's length in bytes. */
  size: number;
  /** The Shard_Content's SHA-256, 64 lowercase hex digits. */
  sha256: string;
}

/** The descriptive fields a Manifest takes from its Source_Record. */
export interface ManifestSource {
  id: string;
  name: string;
  version: string;
  license: AssetLicense;
  credits: string;
  disclaimer: string;
  citation: string;
  source: string;
  sourceSha256: string;
  sourceBytes: number;
}

/** A Manifest, in its canonical key order. */
export interface AssetManifest extends ManifestSource {
  format: typeof MANIFEST_FORMAT;
  formatVersion: number;
  /** The compiled model's `counts()`, for readers and tests; the loader does not rely on it. */
  counts: Record<string, number>;
  /** One `header` entry, then one `stems` entry. */
  shards: ShardEntry[];
}

const HEX64 = /^[0-9a-f]{64}$/u;
const ID = /^[a-z0-9-]+$/u;
const SHARD_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const KEYS = [
  'format',
  'formatVersion',
  'id',
  'name',
  'version',
  'license',
  'credits',
  'disclaimer',
  'citation',
  'source',
  'sourceSha256',
  'sourceBytes',
  'counts',
  'shards',
] as const;

/** Whether `s` is 64 lowercase hex digits, as every SHA-256 here is written. */
export function isSha256Hex(s: unknown): s is string {
  return typeof s === 'string' && HEX64.test(s);
}

/** Whether `path` is a Shard path the loader resolves: a bare file name, not the Manifest's. */
export function isShardPath(path: unknown): path is string {
  return typeof path === 'string' && SHARD_PATH.test(path) && path !== MANIFEST_PATH;
}

/** The canonical bytes of `manifest`. */
export function serializeManifest(manifest: AssetManifest): Uint8Array {
  const canonical = {
    format: manifest.format,
    formatVersion: manifest.formatVersion,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    license: { id: manifest.license.id, url: manifest.license.url },
    credits: manifest.credits,
    disclaimer: manifest.disclaimer,
    citation: manifest.citation,
    source: manifest.source,
    sourceSha256: manifest.sourceSha256,
    sourceBytes: manifest.sourceBytes,
    counts: { ...manifest.counts },
    shards: manifest.shards.map((s) => ({ part: s.part, path: s.path, compression: s.compression, size: s.size, sha256: s.sha256 })),
  };
  return new TextEncoder().encode(JSON.stringify(canonical, null, 2) + '\n');
}

/**
 * The canonical Manifest bytes for a database described by `source`, whose
 * compiled model has `counts`, stored as `shards` (header first).
 */
export function writeManifest(
  source: ManifestSource,
  counts: Readonly<Record<string, number>>,
  shards: readonly ShardEntry[],
): Uint8Array {
  return serializeManifest({
    format: MANIFEST_FORMAT,
    formatVersion: FORMAT_VERSION,
    id: source.id,
    name: source.name,
    version: source.version,
    license: source.license,
    credits: source.credits,
    disclaimer: source.disclaimer,
    citation: source.citation,
    source: source.source,
    sourceSha256: source.sourceSha256,
    sourceBytes: source.sourceBytes,
    counts: { ...counts },
    shards: [...shards],
  });
}

function fail(detail: string, cause?: unknown): never {
  throw new AssetFormatError(
    `${MANIFEST_PATH}: ${detail}`,
    { path: MANIFEST_PATH },
    cause === undefined ? {} : { cause },
  );
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${field} is not an object`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      fail(`${field} has the unknown field ${JSON.stringify(key)}`);
    }
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    fail(`${field} is not a non-empty string`);
  }
  return value;
}

function positive(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    fail(`${field} is not a positive safe integer`);
  }
  return value;
}

/**
 * The Manifest in `bytes`, validated: UTF-8 JSON; `format`
 * `shanisarf-asset`; a `formatVersion` this loader reads (else the error
 * names both); every field of its type and no other; `shards` exactly one
 * `header` and one `stems` entry, each `deflate`, with a positive safe
 * integer `size`, a SHA-256 of 64 lowercase hex digits and a bare-file-name
 * `path`.
 *
 * @throws {AssetFormatError} with `path` `manifest.json`.
 */
export function parseManifest(bytes: Uint8Array): AssetManifest {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch (e) {
    fail('the Manifest is not UTF-8 JSON', e);
  }
  const m = object(value, 'the Manifest');
  if (m['format'] !== MANIFEST_FORMAT) {
    fail(`format is ${JSON.stringify(m['format'])}, not ${JSON.stringify(MANIFEST_FORMAT)}`);
  }
  const formatVersion = m['formatVersion'];
  if (formatVersion !== FORMAT_VERSION) {
    fail(`the Asset is Format_Version ${JSON.stringify(formatVersion)}; this loader reads Format_Version ${FORMAT_VERSION}`);
  }
  onlyKeys(m, KEYS, 'the Manifest');

  const id = text(m['id'], 'id');
  if (!ID.test(id)) {
    fail('id is not lowercase letters, digits and hyphens');
  }
  const license = object(m['license'], 'license');
  onlyKeys(license, ['id', 'url'], 'license');
  const sourceSha256 = m['sourceSha256'];
  if (!isSha256Hex(sourceSha256)) {
    fail('sourceSha256 is not 64 lowercase hex digits');
  }

  const counts = object(m['counts'], 'counts');
  const countsOut: Record<string, number> = {};
  for (const [key, n] of Object.entries(counts)) {
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
      fail(`counts.${key} is not a non-negative safe integer`);
    }
    countsOut[key] = n;
  }

  const shardList = m['shards'];
  if (!Array.isArray(shardList) || shardList.length !== 2) {
    fail('shards does not hold exactly two entries');
  }
  const shards = shardList.map((raw, i): ShardEntry => {
    const field = `shards[${i}]`;
    const s = object(raw, field);
    onlyKeys(s, ['part', 'path', 'compression', 'size', 'sha256'], field);
    const part = s['part'];
    if (part !== 'header' && part !== 'stems') {
      fail(`${field}.part is not "header" or "stems"`);
    }
    if (!isShardPath(s['path'])) {
      fail(`${field}.path is not a bare file name (letters, digits, '.', '_' and '-', not manifest.json)`);
    }
    if (s['compression'] !== 'deflate') {
      fail(`${field}.compression is not "deflate"`);
    }
    if (!isSha256Hex(s['sha256'])) {
      fail(`${field}.sha256 is not 64 lowercase hex digits`);
    }
    return { part, path: s['path'], compression: 'deflate', size: positive(s['size'], `${field}.size`), sha256: s['sha256'] };
  });
  const [first, second] = shards as [ShardEntry, ShardEntry];
  if (first.part !== 'header' || second.part !== 'stems') {
    fail('shards does not hold one header entry and then one stems entry');
  }
  if (first.path === second.path) {
    fail('both shards have the same path');
  }

  return {
    format: MANIFEST_FORMAT,
    formatVersion: FORMAT_VERSION,
    id,
    name: text(m['name'], 'name'),
    version: text(m['version'], 'version'),
    license: { id: text(license['id'], 'license.id'), url: text(license['url'], 'license.url') },
    credits: text(m['credits'], 'credits'),
    disclaimer: text(m['disclaimer'], 'disclaimer'),
    citation: text(m['citation'], 'citation'),
    source: text(m['source'], 'source'),
    sourceSha256,
    sourceBytes: positive(m['sourceBytes'], 'sourceBytes'),
    counts: countsOut,
    shards,
  };
}
