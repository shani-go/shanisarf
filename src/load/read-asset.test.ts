// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for `readAsset` and `loadDatabase` in both variants: over a local
// `node:http` server, a directory and a `.json` source, a 404, a rejected
// `fetch`, an abort, and a refused pin or path, each requesting only the
// Manifest and its Shards (or less); relative strings with and without a page
// location; reader functions returning a view, a string, or rejecting; Node
// paths and `file:` URLs; and every source kind giving an equal model. The
// database is tests/support/generation-mini-db.ts (invented words).

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { type AnyDb, modelDifferences } from '../../tests/property/model-compare.js';
import { MINI_DB } from '../../tests/support/generation-mini-db.js';
import { compileDatabase, type CompiledAsset, writeAsset } from '../compile/compile-database.js';
import { parseAlmor } from '../engine/almor-parser.js';
import type { MorphologyDb } from '../engine/database.js';

import { parseManifest, writeManifest } from './asset-manifest.js';
import { AssetFormatError, AssetIntegrityError, AssetReadError } from './errors.js';
import type { AssetBytes } from './open-asset.js';
import * as browser from './read-asset.js';
import * as node from './read-asset-node.js';

const bytes = new TextEncoder().encode(MINI_DB);
const { createHash } = await import('node:crypto');
const asset: CompiledAsset = await compileDatabase(bytes, {
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
const parsed = parseAlmor(MINI_DB, { flags: 'a' });

/** The files the server serves, by URL path, and every request it saw. */
const files = new Map<string, Uint8Array>();
const requests: string[] = [];
let server: Server;
let origin: string;
let dir: string;

beforeAll(async () => {
  files.set('/asset/manifest.json', asset.manifest);
  for (const [path, stored] of Object.entries(asset.shards)) {
    files.set(`/asset/${path}`, stored);
  }
  server = createServer((req, res) => {
    requests.push(req.url ?? '');
    const body = files.get(req.url ?? '');
    if (req.url === '/slow/manifest.json') {
      setTimeout(() => res.end(asset.manifest), 2_000);
      return;
    }
    if (body === undefined) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(body);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dir = await mkdtemp(join(tmpdir(), 'shanisarf-read-'));
  await writeAsset(join(dir, 'asset'), asset);
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  requests.length = 0;
  delete (globalThis as { location?: unknown }).location;
});

const sameBytes = (got: AssetBytes): void => {
  expect(got.manifest).toEqual(asset.manifest);
  expect(Object.keys(got.shards).sort()).toEqual(Object.keys(asset.shards).sort());
  for (const [path, stored] of Object.entries(asset.shards)) {
    const read = got.shards[path] as Uint8Array;
    expect(read).toEqual(stored);
    expect(read.byteOffset).toBe(0);
    expect(read.byteLength).toBe(read.buffer.byteLength);
  }
};

const sameModel = (db: MorphologyDb): void => {
  expect(modelDifferences(db, parsed as AnyDb)).toEqual([]);
  expect(db.provenance?.assetDigest).toBe(asset.assetDigest);
};

const ASSET_REQUESTS = ['/asset/header.bin', '/asset/manifest.json', '/asset/stems.bin'];

for (const [variant, loader] of [
  ['browser', browser],
  ['node', node],
] as const) {
  describe(`readAsset and loadDatabase over HTTP (${variant} variant)`, () => {
    it('reads a directory, with or without its slash, and a .json Manifest, requesting only the Asset', async () => {
      for (const source of [`${origin}/asset/`, `${origin}/asset`, `${origin}/asset/manifest.json`, new URL(`${origin}/asset`)]) {
        requests.length = 0;
        sameBytes(await loader.readAsset(source));
        expect([...requests].sort(), String(source)).toEqual(ASSET_REQUESTS);
      }
      requests.length = 0;
      sameModel(await loader.loadDatabase(`${origin}/asset/`, { manifestSha256: asset.assetDigest }));
      expect([...requests].sort()).toEqual(ASSET_REQUESTS);
    });

    it('throws AssetReadError with the path and status for a 404', async () => {
      await expect(loader.readAsset(`${origin}/nothing/`)).rejects.toMatchObject({
        name: 'AssetReadError',
        path: 'manifest.json',
        status: 404,
      });
      files.set('/partial/manifest.json', asset.manifest);
      files.set('/partial/header.bin', asset.shards['header.bin'] as Uint8Array);
      const e = await loader.readAsset(`${origin}/partial/`).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(AssetReadError);
      expect(e).toMatchObject({ path: 'stems.bin', status: 404 });
    });

    it('throws AssetReadError with no status, and the cause, when fetch rejects', async () => {
      // Port 0 cannot be connected to, so the fetch rejects without racing
      // another test for a port number.
      const e = (await loader.readAsset('http://127.0.0.1:0/asset/').catch((x: unknown) => x)) as AssetReadError;
      expect(e).toBeInstanceOf(AssetReadError);
      expect([e.path, e.status]).toEqual(['manifest.json', null]);
      expect(e.cause).toBeInstanceOf(Error);
    });

    it('rejects with the signal\'s reason when aborted, before or during a read', async () => {
      const before = new AbortController();
      const reason = new Error('stop');
      before.abort(reason);
      await expect(loader.readAsset(`${origin}/asset/`, { signal: before.signal })).rejects.toBe(reason);
      expect(requests).toEqual([]);
      const during = new AbortController();
      const pending = loader.readAsset(`${origin}/slow/`, { signal: during.signal });
      setTimeout(() => during.abort(reason), 50);
      await expect(pending).rejects.toBe(reason);
    });

    it('checks the pin before parsing the Manifest or requesting a Shard', async () => {
      const e = await loader.readAsset(`${origin}/asset/`, { manifestSha256: '0'.repeat(64) }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(AssetIntegrityError);
      expect(e).toMatchObject({ path: 'manifest.json', expected: '0'.repeat(64), actual: asset.assetDigest });
      expect(requests).toEqual(['/asset/manifest.json']);
    });

    it('never follows a Manifest out of the Asset\'s directory', async () => {
      const m = parseManifest(asset.manifest);
      const text = new TextDecoder()
        .decode(writeManifest(m, m.counts, m.shards))
        .replace('"path": "stems.bin"', `"path": "${origin}/elsewhere/stems.bin"`);
      files.set('/evil/manifest.json', new TextEncoder().encode(text));
      const e = await loader.readAsset(`${origin}/evil/`).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(AssetFormatError);
      expect(requests).toEqual(['/evil/manifest.json']);
    });

    it('reads through a reader function: a view is copied into a buffer of its own, a string is refused', async () => {
      const asked: string[] = [];
      const reader = async (path: string): Promise<ArrayBufferView> => {
        asked.push(path);
        const content = path === 'manifest.json' ? asset.manifest : (asset.shards[path] as Uint8Array);
        const padded = new Uint8Array(content.length + 16);
        padded.set(content, 8);
        return padded.subarray(8, 8 + content.length);
      };
      sameBytes(await loader.readAsset(reader));
      expect(asked.sort()).toEqual(['header.bin', 'manifest.json', 'stems.bin']);
      sameModel(await loader.loadDatabase(reader));

      const text = async () => 'not bytes' as unknown as ArrayBuffer;
      await expect(loader.readAsset(text)).rejects.toMatchObject({ name: 'AssetReadError', path: 'manifest.json', status: null });
      const failing = async (): Promise<ArrayBuffer> => {
        throw new Error('cache miss');
      };
      const e = (await loader.readAsset(failing).catch((x: unknown) => x)) as AssetReadError;
      expect(e).toBeInstanceOf(AssetReadError);
      expect((e.cause as Error).message).toBe('cache miss');
      const buffers = async (path: string) => (path === 'manifest.json' ? asset.manifest : (asset.shards[path] as Uint8Array)).slice().buffer;
      sameBytes(await loader.readAsset(buffers));
    });
  });
}

describe('readAsset: relative strings (browser variant)', () => {
  it('resolves against the page location, and throws TypeError without one', async () => {
    await expect(browser.readAsset('asset/')).rejects.toBeInstanceOf(TypeError);
    (globalThis as { location?: unknown }).location = { href: `${origin}/page/index.html` };
    sameBytes(await browser.readAsset('../asset/'));
    sameBytes(await browser.readAsset('/asset/manifest.json'));
  });
});

describe('readAsset: paths and file: URLs (Node variant)', () => {
  it('reads a directory, a Manifest path, a relative path, and file: URLs as objects and strings', async () => {
    const at = join(dir, 'asset');
    const sources = [
      at,
      `${at}/`,
      join(at, 'manifest.json'),
      relative(process.cwd(), at),
      pathToFileURL(at),
      pathToFileURL(join(at, 'manifest.json')).href,
      `${pathToFileURL(at).href}/`,
    ];
    for (const source of sources) {
      sameBytes(await node.readAsset(source));
    }
    sameModel(await node.loadDatabase(pathToFileURL(join(at, 'manifest.json')).href));
    expect(requests).toEqual([]);
  });

  it('throws AssetReadError for a missing file, and TypeError for another scheme', async () => {
    const e = (await node.readAsset(join(dir, 'missing')).catch((x: unknown) => x)) as AssetReadError;
    expect(e).toBeInstanceOf(AssetReadError);
    expect([e.path, e.status]).toEqual(['manifest.json', null]);
    expect((e.cause as { code?: string }).code).toBe('ENOENT');
    // A Manifest with neither Shard beside it: the Shards are read in
    // parallel, so either may be the one reported.
    await writeFile(join(dir, 'partial.json'), asset.manifest);
    const partial = (await node.readAsset(join(dir, 'partial.json')).catch((x: unknown) => x)) as AssetReadError;
    expect(partial).toBeInstanceOf(AssetReadError);
    expect(['header.bin', 'stems.bin']).toContain(partial.path);
    await expect(node.readAsset(new URL('ftp://example.invalid/asset/'))).rejects.toBeInstanceOf(TypeError);
  });
});
