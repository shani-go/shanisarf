// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for `openAsset`, with each entry's inflate: the model and its
// Provenance; the order of the checks (a bad flag fails before any hashing, a
// bad pin before parsing); the pin; a part mismatch; a missing Shard; and
// bytes that arrive already inflated. The database is
// tests/support/generation-mini-db.ts (invented words).

import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import { type AnyDb, modelDifferences } from '../../tests/property/model-compare.js';
import { MINI_DB } from '../../tests/support/generation-mini-db.js';
import { compileDatabase, type CompiledAsset } from '../compile/compile-database.js';
import type { SourceRecord } from '../compile/source-record.js';
import { parseAlmor } from '../engine/almor-parser.js';
import { InvalidDatabaseFlagError } from '../engine/errors.js';

import { parseManifest, writeManifest } from './asset-manifest.js';
import { AssetFormatError, AssetIntegrityError, AssetReadError } from './errors.js';
import { type Inflate, inflate } from './inflate.js';
import { inflateNode } from './inflate-node.js';
import { type AssetBytes, openAssetWith } from './open-asset.js';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const bytes = new TextEncoder().encode(MINI_DB);
const RECORD: SourceRecord = {
  id: 'mini-db',
  name: 'Mini DB',
  version: '0.1',
  source: 'https://example.invalid/mini.db',
  sourceSha256: sha256(bytes),
  sourceBytes: bytes.length,
  license: { id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  credits: 'Invented test database.',
  disclaimer: 'Invented disclaimer.',
  citation: 'Invented citation.',
};
const asset: CompiledAsset = await compileDatabase(bytes, RECORD);
const copy = (): AssetBytes => ({
  manifest: asset.manifest.slice(),
  shards: Object.fromEntries(Object.entries(asset.shards).map(([k, v]) => [k, v.slice()])),
});

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a rejection');
}

for (const [variant, inflateWith] of [
  ['DecompressionStream', inflate],
  ['node:zlib', inflateNode],
] as [string, Inflate][]) {
  const openAsset = (b: AssetBytes, o?: Parameters<typeof openAssetWith>[2]) => openAssetWith(inflateWith, b, o);

  describe(`openAsset (${variant} inflate)`, () => {
    it('opens the parsed model under a, g and r, carrying its Provenance', async () => {
      for (const flags of [undefined, 'a', 'g', 'r']) {
        const db = await openAsset(copy(), flags === undefined ? {} : { flags });
        const parsed = parseAlmor(MINI_DB, { flags: flags ?? 'a' });
        expect(modelDifferences(db, parsed as AnyDb), String(flags)).toEqual([]);
        expect(db.counts()).toEqual(parsed.counts());
        expect(db.provenance).toEqual({
          id: 'mini-db',
          name: 'Mini DB',
          version: '0.1',
          license: RECORD.license,
          credits: RECORD.credits,
          disclaimer: RECORD.disclaimer,
          citation: RECORD.citation,
          source: RECORD.source,
          sourceSha256: RECORD.sourceSha256,
          sourceBytes: RECORD.sourceBytes,
          formatVersion: 1,
          assetDigest: asset.assetDigest,
        });
        expect(Object.isFrozen(db.provenance)).toBe(true);
      }
    });

    it('reads the flags first: a bad flag fails before any hashing or inflating', async () => {
      const spy = vi.fn(inflateWith);
      const e = await rejection(openAssetWith(spy, { manifest: Uint8Array.of(1, 2, 3), shards: {} }, { flags: 'ax' }));
      expect(e).toBeInstanceOf(InvalidDatabaseFlagError);
      expect((e as InvalidDatabaseFlagError).flag).toBe('x');
      expect(spy).not.toHaveBeenCalled();
    });

    it('checks the pin before parsing the Manifest', async () => {
      const wrong = 'f'.repeat(64);
      const e = await rejection(openAsset({ manifest: Uint8Array.of(1, 2, 3), shards: {} }, { manifestSha256: wrong }));
      expect(e).toBeInstanceOf(AssetIntegrityError);
      expect(e).toMatchObject({ path: 'manifest.json', expected: wrong, actual: sha256(Uint8Array.of(1, 2, 3)) });
      await expect(openAsset(copy(), { manifestSha256: asset.assetDigest.toUpperCase() })).resolves.toBeDefined();
      await expect(openAsset(copy(), { manifestSha256: 'xyz' })).rejects.toBeInstanceOf(TypeError);
    });

    it('refuses a Manifest that is not one, naming manifest.json', async () => {
      const e = await rejection(openAsset({ manifest: Uint8Array.of(1, 2, 3), shards: {} }));
      expect(e).toBeInstanceOf(AssetFormatError);
      expect((e as AssetFormatError).path).toBe('manifest.json');
    });

    it('refuses a Shard whose Container holds another part, naming its file', async () => {
      const m = parseManifest(asset.manifest);
      const [header, stems] = m.shards as [(typeof m.shards)[0], (typeof m.shards)[0]];
      const swapped = writeManifest(m, m.counts, [
        { ...stems, part: 'header' },
        { ...header, part: 'stems' },
      ]);
      const e = await rejection(openAsset({ ...copy(), manifest: swapped }));
      expect(e).toBeInstanceOf(AssetFormatError);
      expect((e as AssetFormatError).path).toMatch(/^(header|stems)\.bin$/u);
      expect(e.message).toMatch(/^(header|stems)\.bin: the Container holds part/u);
    });

    it('refuses bytes that lack a Shard the Manifest names', async () => {
      const b = copy();
      delete b.shards['stems.bin'];
      const e = await rejection(openAsset(b));
      expect(e).toBeInstanceOf(AssetReadError);
      expect(e).toMatchObject({ path: 'stems.bin', status: null });
    });

    it('keeps Shards that arrive already inflated, and still checks their size and SHA-256', async () => {
      const inflated = copy();
      for (const path of Object.keys(inflated.shards)) {
        inflated.shards[path] = new Uint8Array(inflateSync(inflated.shards[path] as Uint8Array));
      }
      const spy = vi.fn(inflateWith);
      const db = await openAssetWith(spy, inflated, { flags: 'r' });
      expect(spy).not.toHaveBeenCalled();
      expect(modelDifferences(db, parseAlmor(MINI_DB, { flags: 'r' }) as AnyDb)).toEqual([]);

      const changed = inflated.shards['header.bin'] as Uint8Array;
      changed[changed.length - 1] = (changed[changed.length - 1] as number) ^ 1;
      const e = await rejection(openAsset(inflated));
      expect(e).toBeInstanceOf(AssetIntegrityError);
      expect(e).toMatchObject({ path: 'header.bin', expected: parseManifest(asset.manifest).shards[0]!.sha256 });

      inflated.shards['header.bin'] = changed.subarray(0, changed.length - 1);
      expect(await rejection(openAsset(inflated))).toMatchObject({ name: 'AssetIntegrityError', path: 'header.bin' });
    });

    it('refuses a changed stored byte', async () => {
      const b = copy();
      const stored = b.shards['stems.bin'] as Uint8Array;
      stored[stored.length >> 1] = (stored[stored.length >> 1] as number) ^ 0x10;
      const e = await rejection(openAsset(b));
      expect(e).toBeInstanceOf(AssetIntegrityError);
      expect((e as AssetIntegrityError).path).toBe('stems.bin');
    });

    it('refuses something that is not Asset_Bytes', async () => {
      await expect(openAsset({ manifest: 'x', shards: {} } as unknown as AssetBytes)).rejects.toBeInstanceOf(TypeError);
      await expect(openAsset(null as unknown as AssetBytes)).rejects.toBeInstanceOf(TypeError);
    });
  });
}
