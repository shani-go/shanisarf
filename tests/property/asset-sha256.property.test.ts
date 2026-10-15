// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The SHA-256 fallback is SHA-256. For any byte array of length 0 to 1,000,
// with lengths around the 56-byte padding boundary and the 64-byte block
// forced in, the JavaScript SHA-256 equals `node:crypto`'s and
// `crypto.subtle`'s, and so does `sha256()`, whichever it uses; one array of
// 1 MiB agrees too. `node:crypto` is the reference: no third-party test vector
// is copied.

import { createHash, webcrypto } from 'node:crypto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { sha256, sha256Js, toHex } from '../../src/load/sha256.js';

const reference = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const subtleHex = async (bytes: Uint8Array): Promise<string> =>
  toHex(new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes)));

const FORCED = [55, 56, 63, 64, ...Array.from({ length: 10 }, (_, i) => 119 + i)];
const lengths = fc.oneof(fc.integer({ min: 0, max: 1000 }), fc.constantFrom(...FORCED));
const inputs = lengths.chain((n) => fc.uint8Array({ minLength: n, maxLength: n }));

describe('the SHA-256 fallback is SHA-256', () => {
  it('equals node:crypto and crypto.subtle over arrays of 0 to 1,000 bytes', async () => {
    await fc.assert(
      fc.asyncProperty(inputs, async (bytes) => {
        const want = reference(bytes);
        expect(toHex(sha256Js(bytes))).toBe(want);
        expect(await subtleHex(bytes)).toBe(want);
        expect(await sha256(bytes)).toBe(want);
      }),
      { numRuns: 200 },
    );
  });

  it('equals node:crypto over one array of 1 MiB, and over a view into a larger buffer', async () => {
    const big = new Uint8Array(1 << 20);
    for (let i = 0; i < big.length; i++) {
      big[i] = (i * 2654435761) >>> 24;
    }
    expect(toHex(sha256Js(big))).toBe(reference(big));
    expect(await subtleHex(big)).toBe(reference(big));
    const view = big.subarray(3, 3 + 1000);
    expect(toHex(sha256Js(view))).toBe(reference(view));
    expect(await sha256(view)).toBe(reference(view));
  });
});
