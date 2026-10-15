// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the Manifest: canonical output that re-parses and
// re-serializes to the same bytes, and one example per refusal. The record is
// invented.

import { describe, expect, it } from 'vitest';

import {
  type AssetManifest,
  isShardPath,
  parseManifest,
  serializeManifest,
  type ShardEntry,
  writeManifest,
} from './asset-manifest.js';
import { AssetFormatError } from './errors.js';

const SOURCE = {
  id: 'invented-db',
  name: 'Invented DB',
  version: '0.1',
  license: { id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  credits: 'Invented credits.',
  disclaimer: 'Invented disclaimer.',
  citation: 'Invented citation.',
  source: 'https://example.invalid/db.txt',
  sourceSha256: 'a'.repeat(64),
  sourceBytes: 1234,
};
const SHARDS: ShardEntry[] = [
  { part: 'header', path: 'header.bin', compression: 'deflate', size: 100, sha256: 'b'.repeat(64) },
  { part: 'stems', path: 'stems.bin', compression: 'deflate', size: 200, sha256: 'c'.repeat(64) },
];
const COUNTS = { prefixSurfaces: 3, stemEntries: 7 };

const canonical = writeManifest(SOURCE, COUNTS, SHARDS);
const text = new TextDecoder().decode(canonical);

/** Parsing the Manifest after `change` to its JSON object fails with `pattern`. */
function refuses(pattern: RegExp, change: (m: Record<string, unknown>) => void): void {
  const m = JSON.parse(text) as Record<string, unknown>;
  change(m);
  const bytes = new TextEncoder().encode(JSON.stringify(m, null, 2) + '\n');
  let error: unknown;
  try {
    parseManifest(bytes);
  } catch (e) {
    error = e;
  }
  expect(error, String(pattern)).toBeInstanceOf(AssetFormatError);
  expect((error as AssetFormatError).path).toBe('manifest.json');
  expect((error as AssetFormatError).section).toBeNull();
  expect((error as AssetFormatError).message).toMatch(pattern);
}

const shard = (m: Record<string, unknown>, i: number) => (m['shards'] as Record<string, unknown>[])[i] as Record<string, unknown>;

describe('the Manifest', () => {
  it('is canonical JSON: the key order, two-space indent, \\n line ends and a final newline', () => {
    expect(Object.keys(JSON.parse(text))).toEqual([
      'format', 'formatVersion', 'id', 'name', 'version', 'license', 'credits', 'disclaimer',
      'citation', 'source', 'sourceSha256', 'sourceBytes', 'counts', 'shards',
    ]);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).not.toContain('\r');
    expect(text.split('\n')[1]).toBe('  "format": "shanisarf-asset",');
    expect(text).toContain('"formatVersion": 1,');
  });

  it('re-parses and re-serializes to the same bytes', () => {
    const parsed: AssetManifest = parseManifest(canonical);
    expect(serializeManifest(parsed)).toEqual(canonical);
    expect(parsed.shards).toEqual(SHARDS);
    expect(parsed.counts).toEqual(COUNTS);
  });

  it('records no compiler, engine or package version', () => {
    expect(text).not.toMatch(/compiler|engine|shanisarf@|"package/u);
  });

  it('refuses bytes that are not UTF-8 JSON', () => {
    for (const bytes of [Uint8Array.of(0xff, 0x7b, 0x7d), new TextEncoder().encode('{"format":'), new TextEncoder().encode('﻿' + text)]) {
      expect(() => parseManifest(bytes)).toThrow(/not UTF-8 JSON/u);
    }
  });

  it('names both versions for another Format_Version', () => {
    refuses(/Format_Version 2; this loader reads Format_Version 1/u, (m) => (m['formatVersion'] = 2));
  });

  it('refuses a wrong format, a missing or mistyped field, and an unknown one', () => {
    refuses(/format is "other"/u, (m) => (m['format'] = 'other'));
    refuses(/name is not a non-empty string/u, (m) => delete m['name']);
    refuses(/credits is not a non-empty string/u, (m) => (m['credits'] = ''));
    refuses(/license\.url/u, (m) => ((m['license'] as Record<string, unknown>)['url'] = 3));
    refuses(/id is not lowercase/u, (m) => (m['id'] = 'Invented DB'));
    refuses(/sourceSha256/u, (m) => (m['sourceSha256'] = 'A'.repeat(64)));
    refuses(/sourceBytes is not a positive safe integer/u, (m) => (m['sourceBytes'] = 0));
    refuses(/counts\.stemEntries/u, (m) => ((m['counts'] as Record<string, unknown>)['stemEntries'] = -1));
    refuses(/unknown field "compiler"/u, (m) => (m['compiler'] = '1.0'));
  });

  it('refuses shards other than one header and one stems entry, each deflate with a size and SHA-256', () => {
    refuses(/exactly two entries/u, (m) => (m['shards'] as unknown[]).pop());
    refuses(/one header entry and then one stems entry/u, (m) => (shard(m, 1)['part'] = 'header'));
    refuses(/shards\[0\]\.part/u, (m) => (shard(m, 0)['part'] = 'lemmas'));
    refuses(/shards\[1\]\.compression/u, (m) => (shard(m, 1)['compression'] = 'gzip'));
    refuses(/shards\[0\]\.size/u, (m) => (shard(m, 0)['size'] = 1.5));
    refuses(/shards\[1\]\.sha256/u, (m) => (shard(m, 1)['sha256'] = 'c'.repeat(63)));
    refuses(/same path/u, (m) => (shard(m, 1)['path'] = 'header.bin'));
  });

  it('refuses a Shard path that is not a bare file name', () => {
    for (const path of ['../stems.bin', 'a/b.bin', 'https://other.invalid/s.bin', '.hidden', '', 'manifest.json', 'x\\y', 'stems.bin?x']) {
      expect(isShardPath(path), path).toBe(false);
      refuses(/shards\[1\]\.path/u, (m) => (shard(m, 1)['path'] = path));
    }
    for (const path of ['stems.bin', 'S_1-2.bin', '0']) {
      expect(isShardPath(path), path).toBe(true);
    }
  });
});
