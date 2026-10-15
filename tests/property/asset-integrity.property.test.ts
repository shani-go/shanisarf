// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// A changed byte never loads. For any `almorDoc` Asset, any Shard, and any
// byte position and non-zero XOR mask, opened through either entry's
// `openAsset`: a changed byte of the Stored_Bytes, or of Shard_Content
// delivered already inflated, throws `AssetIntegrityError` or
// `AssetFormatError`, or (in a region deflate ignores) yields a model equal to
// the original, never a different one; with `manifestSha256` given, a changed
// Manifest byte throws `AssetIntegrityError`; and a truncated Shard throws one
// of the two.

import fc from 'fast-check';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { AssetFormatError, AssetIntegrityError } from '../../src/load/errors.js';
import type { AssetBytes } from '../../src/load/open-asset.js';
import type { MorphologyDb } from '../../src/engine/index.js';

import { almorDoc } from './arbitraries';
import { assetCopy, compileText, OPENERS } from './asset-support';
import { type AnyDb, modelDifferences } from './model-compare';

/** `open`'s outcome: `'refused'` for an asset error, else the model's differences from `original`. */
async function verdict(open: Promise<MorphologyDb>, original: MorphologyDb): Promise<'refused' | string[]> {
  try {
    return modelDifferences(await open, original as AnyDb);
  } catch (e) {
    if (e instanceof AssetIntegrityError || e instanceof AssetFormatError) {
      return 'refused';
    }
    throw e;
  }
}

const accepted = (v: 'refused' | string[]): boolean => v === 'refused' || v.length === 0;

describe('a changed byte never loads', () => {
  it('refuses a changed or truncated Shard, stored or inflated, and a changed pinned Manifest', async () => {
    await fc.assert(
      fc.asyncProperty(
        almorDoc,
        fc.constantFrom<'stream' | 'zlib'>('stream', 'zlib'),
        fc.constantFrom('header.bin', 'stems.bin'),
        fc.nat(),
        fc.integer({ min: 1, max: 255 }),
        fc.nat(),
        async (text, opener, path, at, mask, cut) => {
          const open = OPENERS[opener];
          const asset = await compileText(text);
          const original = await open(asset, { flags: 'r' });

          // A changed byte of the Stored_Bytes.
          const stored = assetCopy(asset);
          const bytes = stored.shards[path] as Uint8Array;
          bytes[at % bytes.length] = (bytes[at % bytes.length] as number) ^ mask;
          expect(accepted(await verdict(open(stored, { flags: 'r' }), original)), `stored ${path}@${at % bytes.length}`).toBe(true);

          // A changed byte of the Shard_Content, delivered already inflated.
          const inflated: AssetBytes = assetCopy(asset);
          for (const p of Object.keys(inflated.shards)) {
            inflated.shards[p] = new Uint8Array(inflateSync(inflated.shards[p] as Uint8Array));
          }
          const content = inflated.shards[path] as Uint8Array;
          content[at % content.length] = (content[at % content.length] as number) ^ mask;
          const v = await verdict(open(inflated, { flags: 'r' }), original);
          expect(v, `inflated ${path}@${at % content.length}`).toBe('refused');

          // A changed Manifest byte under the pin.
          const pinned = assetCopy(asset);
          pinned.manifest[at % pinned.manifest.length] = (pinned.manifest[at % pinned.manifest.length] as number) ^ mask;
          await expect(open(pinned, { flags: 'r', manifestSha256: asset.assetDigest })).rejects.toBeInstanceOf(AssetIntegrityError);

          // A truncated Shard, stored and inflated.
          const truncatedStored = assetCopy(asset);
          truncatedStored.shards[path] = (truncatedStored.shards[path] as Uint8Array).subarray(0, cut % (asset.shards[path] as Uint8Array).length);
          expect(await verdict(open(truncatedStored, { flags: 'r' }), original)).toBe('refused');
          const truncatedContent = assetCopy(inflated);
          truncatedContent.shards[path] = (truncatedContent.shards[path] as Uint8Array).subarray(0, cut % content.length);
          expect(await verdict(open(truncatedContent, { flags: 'r' }), original)).toBe('refused');
        },
      ),
      { numRuns: 200 },
    );
  });
});
