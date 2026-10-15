// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the two inflates, the stream variant and the Node entry's
// `node:zlib` variant, each with the same cases: a round trip with
// `node:zlib`'s `deflateSync`, an overrun, a short output, a corrupt byte,
// truncation and trailing bytes; and the magic test.

import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { AssetIntegrityError } from './errors.js';
import { type Inflate, inflate, isContainer } from './inflate.js';
import { inflateNode } from './inflate-node.js';

const content = Uint8Array.from({ length: 50_000 }, (_, i) => (i * 31) % 251);
const stored = new Uint8Array(deflateSync(content, { level: 9 }));

async function failure(promise: Promise<unknown>): Promise<AssetIntegrityError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(AssetIntegrityError);
    return e as AssetIntegrityError;
  }
  throw new Error('expected an AssetIntegrityError');
}

const VARIANTS: [string, Inflate][] = [
  ['DecompressionStream', inflate],
  ['node:zlib', inflateNode],
];

for (const [variant, inflate] of VARIANTS) {
  describe(`inflate (${variant})`, () => {
    it('round-trips node:zlib deflate output into a buffer of exactly the size', async () => {
      const out = await inflate(stored, content.length, 'stems.bin');
      expect(out).toEqual(content);
      expect(out.buffer.byteLength).toBe(content.length);
    });

    it('stops at the size: an overrun is an integrity error', async () => {
      const e = await failure(inflate(stored, content.length - 1, 'stems.bin'));
      expect(e.path).toBe('stems.bin');
      expect(e.expected).toBe(String(content.length - 1));
      expect(e.actual).toBe(`more than ${content.length - 1}`);
    });

    it('a short output is an integrity error', async () => {
      const e = await failure(inflate(stored, content.length + 1, 'header.bin'));
      expect(e.expected).toBe(String(content.length + 1));
      expect(e.actual).toBe(String(content.length));
    });

    it('a corrupt byte, truncation and trailing bytes fail in the decompressor', async () => {
      const corrupt = stored.slice();
      corrupt[stored.length >> 1] = (corrupt[stored.length >> 1] as number) ^ 0x5a;
      const truncated = stored.subarray(0, stored.length - 3);
      const trailing = Uint8Array.of(...stored, 0, 1, 2);
      for (const bytes of [corrupt, truncated, trailing]) {
        const e = await failure(inflate(bytes, content.length, 'stems.bin'));
        expect(e.path).toBe('stems.bin');
      }
      const adler = stored.slice();
      adler[adler.length - 1] = (adler[adler.length - 1] as number) ^ 1;
      const e = await failure(inflate(adler, content.length, 'stems.bin'));
      expect(e.message).toMatch(/corrupt or truncated/u);
      expect(e.cause).toBeDefined();
      expect(Object.keys(e)).not.toContain('cause');
    });
  });
}

describe('isContainer', () => {
  it('tests for the SHSF magic, which no zlib stream begins with', () => {
    expect(isContainer(Uint8Array.of(0x53, 0x48, 0x53, 0x46, 1, 0))).toBe(true);
    expect(isContainer(Uint8Array.of(0x53, 0x48, 0x53))).toBe(false);
    expect(isContainer(stored)).toBe(false);
    expect(isContainer(new Uint8Array(deflateSync(Uint8Array.of(0x53, 0x48, 0x53, 0x46))))).toBe(false);
  });
});
