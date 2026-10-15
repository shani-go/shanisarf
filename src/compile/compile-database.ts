// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The compiler: any ALMOR database and the Source_Record that describes it
// into an Asset, a canonical `manifest.json` and two Shards.
// `compileDatabase`, in order:
//
//   1. validates the Source_Record (`SourceRecordError` naming the field);
//   2. checks the bytes' length against `sourceBytes` and their SHA-256
//      against `sourceSha256` (`SourceRecordError`): it fails closed on a
//      database that is not the one the record describes;
//   3. decodes the bytes with `TextDecoder('utf-8', { ignoreBOM: true })`,
//      not fatal, as the worker does, so a byte order mark reaches the
//      parser as it does through `readFileSync(path, 'utf8')`;
//   4. keeps every stem's `lex_logprob` and `pos_lex_logprob` as the
//      database publishes them, or sets them to `-99` when the
//      `stripLogprobs` option is given (see the `stripLogprobs` function);
//   5. parses with `parseAlmor(text, { flags: 'r' })`, so every parse error
//      is the parser's own and the Asset carries every table;
//   6. encodes the model (the Model_Codec), writes each part's Container,
//      hashes it, and deflates it with `node:zlib` at `level` (9 by
//      default);
//   7. writes the Manifest from the record, the counts and the Shards.
//
// The Manifest names each Shard_Content's size and SHA-256, never the
// Stored_Bytes', so the Asset_Digest (the Manifest's SHA-256) is the same on
// every machine and at every deflate level.
//
// The compiler is new design and Node only: `shanisarf/compile` exports it
// under a `node` condition with no `default`, so a browser bundler fails to
// resolve it instead of bundling `node:fs`.
//
// This is a new-design file: project header only.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { parseAlmor } from '../engine/almor-parser.js';
import { encodeModel } from '../engine/model-codec.js';
import { MANIFEST_PATH, type ShardEntry, writeManifest } from '../load/asset-manifest.js';
import { SourceRecordError } from '../load/errors.js';
import { sha256 } from '../load/sha256.js';
import type { PartKind } from '../load/shard-container.js';

import { writeContainer } from './shard-writer.js';
import { parseSourceRecord, type SourceRecord } from './source-record.js';

/** A compiled Asset, in memory. */
export interface CompiledAsset {
  /** The Manifest's canonical bytes. */
  manifest: Uint8Array;
  /** Shard path → Stored_Bytes (deflated). */
  shards: Record<string, Uint8Array>;
  /** The Manifest's SHA-256, 64 lowercase hex digits. */
  assetDigest: string;
}

/** Options for {@link compileDatabase}. */
export interface CompileOptions {
  /** The deflate level, 0 to 9; 9 by default. It changes the Stored_Bytes, never the Manifest. */
  level?: number;
  /**
   * Set every stem's `lex_logprob` and `pos_lex_logprob` to `-99` instead of
   * compiling the database's values in; the Manifest's disclaimer then says
   * so. Off by default: the values are part of the database as published
   * under its license (for Camel Morph MSA, see NOTICE).
   */
  stripLogprobs?: boolean;
}

/** Appended to the disclaimer of an Asset compiled with `stripLogprobs`. */
export const STRIPPED_LOGPROBS_NOTICE =
  "This asset sets every stem's lex_logprob and pos_lex_logprob to -99; the database's own values were not " +
  'compiled in.';

/**
 * `text` with every `lex_logprob` and `pos_lex_logprob` value in its
 * `###STEMS###` section set to `-99`, upstream's "no value" marker. The
 * `stripLogprobs` compile option applies it, for a caller who wants an Asset
 * without the database's frequency scores. No engine path reads them.
 */
export function stripLogprobs(text: string): string {
  const start = text.indexOf('###STEMS###');
  if (start === -1) return text;
  const end = text.indexOf('\n###', start);
  const stems = text.slice(start, end === -1 ? undefined : end);
  return text.slice(0, start) + stems.replace(/([\t ](?:pos_)?lex_logprob:)[^\s]*/gu, '$1-99') + (end === -1 ? '' : text.slice(end));
}

/** The Shard file of each part. */
const SHARD_PATHS: Readonly<Record<PartKind, string>> = Object.freeze({ header: 'header.bin', stems: 'stems.bin' });

/**
 * Compile the ALMOR database `bytes`, which `record` describes, into an
 * Asset.
 *
 * @throws {SourceRecordError} for a malformed record, or bytes whose length
 *   or SHA-256 differs from the record's.
 * @throws {DatabaseParseError} as the parser throws it.
 */
export async function compileDatabase(
  bytes: Uint8Array,
  record: SourceRecord,
  options: CompileOptions = {},
): Promise<CompiledAsset> {
  const source = parseSourceRecord(record);
  if (bytes.length !== source.sourceBytes) {
    throw new SourceRecordError(
      `the database is ${bytes.length} bytes, but the Source_Record's sourceBytes is ${source.sourceBytes}`,
      'sourceBytes',
    );
  }
  const digest = await sha256(bytes);
  if (digest !== source.sourceSha256) {
    throw new SourceRecordError(
      `the database's SHA-256 is ${digest}, but the Source_Record's sourceSha256 is ${source.sourceSha256}`,
      'sourceSha256',
    );
  }

  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  const db = parseAlmor(options.stripLogprobs === true ? stripLogprobs(text) : text, { flags: 'r' });
  const encoded = encodeModel(db);
  const level = options.level ?? 9;
  const shards: Record<string, Uint8Array> = {};
  const entries: ShardEntry[] = [];
  for (const [part, { meta, sections }] of [
    ['header', encoded.header],
    ['stems', encoded.stem],
  ] as const) {
    const content = writeContainer(part, meta, sections);
    const path = SHARD_PATHS[part];
    entries.push({ part, path, compression: 'deflate', size: content.length, sha256: await sha256(content) });
    const stored = deflateSync(content, { level });
    shards[path] = new Uint8Array(stored.buffer, stored.byteOffset, stored.byteLength);
  }
  const described =
    options.stripLogprobs === true ? { ...source, disclaimer: `${source.disclaimer} ${STRIPPED_LOGPROBS_NOTICE}` } : source;
  const manifest = writeManifest(described, db.counts(), entries);
  return { manifest, shards, assetDigest: await sha256(manifest) };
}

/**
 * Write `asset` into `dir`, creating it if needed: the Shards first, then
 * `manifest.json`, so a directory whose Manifest is new also has the Shards
 * it names. Any other file in `dir` is left alone. Filesystem errors pass
 * through.
 */
export async function writeAsset(dir: string, asset: CompiledAsset): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const [path, stored] of Object.entries(asset.shards)) {
    await writeFile(join(dir, path), stored);
  }
  await writeFile(join(dir, MANIFEST_PATH), asset.manifest);
}

/**
 * Compile the database at `dbPath`, described by the Source_Record JSON at
 * `recordPath`, and write the Asset into `outDir`.
 *
 * @throws {SourceRecordError} when the record is not JSON or not valid, or
 *   does not describe the database.
 */
export async function compileDatabaseFile(
  dbPath: string,
  recordPath: string,
  outDir: string,
  options: CompileOptions = {},
): Promise<CompiledAsset> {
  const [bytes, recordText] = await Promise.all([readFile(dbPath), readFile(recordPath, 'utf8')]);
  let record: unknown;
  try {
    record = JSON.parse(recordText);
  } catch (e) {
    throw new SourceRecordError(`${recordPath} is not JSON`, '(record)', { cause: e });
  }
  const asset = await compileDatabase(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    parseSourceRecord(record),
    options,
  );
  await writeAsset(outDir, asset);
  return asset;
}
