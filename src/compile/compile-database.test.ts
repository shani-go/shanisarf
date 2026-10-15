// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the compiler: a database of the wrong size or hash throws
// `SourceRecordError`; a parse error is the parser's own; `writeAsset` writes
// the Shards before the Manifest and leaves other files alone;
// `compileDatabaseFile` reads, compiles and writes; and a compiled Asset's
// Containers decode to the parsed model. The database is
// tests/support/generation-mini-db.ts (invented words) and the record is
// invented.

import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MINI_DB } from '../../tests/support/generation-mini-db.js';
import { type AnyDb, modelDifferences } from '../../tests/property/model-compare.js';
import { parseAlmor } from '../engine/almor-parser.js';
import { readDatabaseFlags } from '../engine/database.js';
import { DatabaseParseError } from '../engine/errors.js';
import { decodeModel } from '../engine/model-codec.js';
import { parseManifest } from '../load/asset-manifest.js';
import { SourceRecordError } from '../load/errors.js';
import { readContainer } from '../load/shard-container.js';

import { compileDatabase, compileDatabaseFile, STRIPPED_LOGPROBS_NOTICE, stripLogprobs, writeAsset } from './compile-database.js';
import type { SourceRecord } from './source-record.js';

const { writes } = vi.hoisted(() => ({ writes: [] as string[] }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      writes.push(String(args[0]));
      return actual.writeFile(...args);
    },
  };
});

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const recordFor = (bytes: Uint8Array): SourceRecord => ({
  id: 'mini-db',
  name: 'Mini DB',
  version: '0.1',
  source: 'https://example.invalid/mini.db',
  sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  sourceBytes: bytes.length,
  license: { id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  credits: 'Invented test database.',
  disclaimer: 'Invented disclaimer.',
  citation: 'Invented citation.',
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shanisarf-compile-'));
  writes.length = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('compileDatabase', () => {
  const bytes = bytesOf(MINI_DB);

  it('compiles a database whose Containers decode to the parsed model', async () => {
    const asset = await compileDatabase(bytes, recordFor(bytes));
    const manifest = parseManifest(asset.manifest);
    expect(asset.assetDigest).toBe(createHash('sha256').update(asset.manifest).digest('hex'));
    expect(Object.keys(asset.shards)).toEqual(['header.bin', 'stems.bin']);
    const [header, stems] = manifest.shards.map((s) => {
      const content = new Uint8Array(inflateSync(asset.shards[s.path]!));
      expect(content.length).toBe(s.size);
      expect(createHash('sha256').update(content).digest('hex')).toBe(s.sha256);
      return readContainer(content, s.part);
    });
    const loaded = decodeModel(header!, stems!, readDatabaseFlags('r'), null);
    const parsed = parseAlmor(MINI_DB, { flags: 'r' });
    expect(modelDifferences(loaded, parsed as AnyDb)).toEqual([]);
    expect(manifest.counts).toEqual({ ...parsed.counts() });
  });

  it('fails closed on a database of the wrong size or hash', async () => {
    const record = recordFor(bytes);
    await expect(compileDatabase(bytes.subarray(1), record)).rejects.toMatchObject({
      name: 'SourceRecordError',
      field: 'sourceBytes',
    });
    const changed = bytes.slice();
    changed[10] = (changed[10] as number) ^ 1;
    await expect(compileDatabase(changed, record)).rejects.toMatchObject({ name: 'SourceRecordError', field: 'sourceSha256' });
    await expect(compileDatabase(bytes, { ...record, credits: '' })).rejects.toBeInstanceOf(SourceRecordError);
  });

  it('lets the parser\'s own error through, a byte order mark included', async () => {
    for (const text of [MINI_DB.replace('###DEFAULTS###', 'DEFAULTS'), '﻿' + MINI_DB]) {
      const b = bytesOf(text);
      const thrown = await compileDatabase(b, recordFor(b)).catch((e: unknown) => e);
      expect(thrown).toBeInstanceOf(DatabaseParseError);
      expect((thrown as Error).message).toBe(
        (() => {
          try {
            parseAlmor(text, { flags: 'r' });
          } catch (e) {
            return (e as Error).message;
          }
          return 'parsed';
        })(),
      );
    }
  });
});

describe('writeAsset and compileDatabaseFile', () => {
  it('writes the Shards before the Manifest, creating the directory and leaving other files alone', async () => {
    const out = join(dir, 'nested', 'asset');
    const bytes = bytesOf(MINI_DB);
    const asset = await compileDatabase(bytes, recordFor(bytes));
    await writeAsset(out, asset);
    expect(writes).toEqual([join(out, 'header.bin'), join(out, 'stems.bin'), join(out, 'manifest.json')]);

    await writeFile(join(out, 'README.txt'), 'kept');
    await writeAsset(out, asset);
    expect((await readdir(out)).sort()).toEqual(['README.txt', 'header.bin', 'manifest.json', 'stems.bin']);
    expect(await readFile(join(out, 'README.txt'), 'utf8')).toBe('kept');
    expect(new Uint8Array(await readFile(join(out, 'manifest.json')))).toEqual(asset.manifest);
  });

  it('reads both files, compiles and writes; a record that is not JSON is a SourceRecordError', async () => {
    const dbPath = join(dir, 'mini.db');
    const recordPath = join(dir, 'source.json');
    await writeFile(dbPath, MINI_DB);
    await writeFile(recordPath, JSON.stringify(recordFor(bytesOf(MINI_DB))));
    const asset = await compileDatabaseFile(dbPath, recordPath, join(dir, 'out'));
    expect(new Uint8Array(await readFile(join(dir, 'out', 'manifest.json')))).toEqual(asset.manifest);

    await writeFile(recordPath, '{ not json');
    await expect(compileDatabaseFile(dbPath, recordPath, join(dir, 'out2'))).rejects.toMatchObject({
      name: 'SourceRecordError',
      field: '(record)',
    });
  });
});

describe('log-probabilities (lex_logprob and pos_lex_logprob)', () => {
  it('are set to -99 on stem lines only, and nothing else changes', () => {
    const text =
      'DEFAULT lex_logprob:-3\n###STEMS###\nk\tX1\tdiac:k xlex_logprob:-1 lex_logprob:-1.5 pos_lex_logprob:-99 pos_logprob:-2\n' +
      'q\tX2\tpos_lex_logprob:-4.25\n###TABLE AB###\nP1 X1 lex_logprob:-5\n';
    expect(stripLogprobs(text)).toBe(
      'DEFAULT lex_logprob:-3\n###STEMS###\nk\tX1\tdiac:k xlex_logprob:-1 lex_logprob:-99 pos_lex_logprob:-99 pos_logprob:-2\n' +
        'q\tX2\tpos_lex_logprob:-99\n###TABLE AB###\nP1 X1 lex_logprob:-5\n',
    );
  });

  it('are kept by default and stripped only on request, and a stripped Asset says so in its disclaimer', async () => {
    const bytes = bytesOf(MINI_DB);
    const kept = parseManifest((await compileDatabase(bytes, recordFor(bytes))).manifest);
    const stripped = parseManifest((await compileDatabase(bytes, recordFor(bytes), { stripLogprobs: true })).manifest);
    expect(kept.disclaimer).toBe(recordFor(bytes).disclaimer);
    expect(stripped.disclaimer).toBe(`${recordFor(bytes).disclaimer} ${STRIPPED_LOGPROBS_NOTICE}`);
  });
});
