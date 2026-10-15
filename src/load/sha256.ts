// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// SHA-256. `sha256(bytes)` uses `crypto.subtle.digest` where it exists.
// Browsers give `crypto.subtle` only to secure contexts, so a page served
// over plain `http` from a host other than `localhost` has none; there, and
// in any runtime without it, the JavaScript SHA-256 below computes it
// instead. Integrity is never skipped. A property test holds the fallback to
// `node:crypto` and to `crypto.subtle` over random inputs; no test vector is
// copied from a third party.
//
// The fallback is written after FIPS 180-4 (§4.1.2 functions, §5.1.1
// padding, §6.2.2 computation). Its constants are derived here rather than
// listed: the initial hash words are the first 32 bits of the fractional
// parts of the square roots of the first 8 primes (§5.3.3), and the round
// constants those of the cube roots of the first 64 primes (§4.2.2), each
// computed exactly as an integer root with BigInt.
//
// This is a new-design file: project header only.

/** The first `count` primes. */
function primes(count: number): number[] {
  const out: number[] = [];
  for (let n = 2; out.length < count; n++) {
    if (out.every((p) => n % p !== 0)) {
      out.push(n);
    }
  }
  return out;
}

/** ⌊n^(1/k)⌋ for k 2 or 3, by Newton's method from above. */
function integerRoot(n: bigint, k: 2 | 3): bigint {
  const K = BigInt(k);
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / k) + 1);
  for (;;) {
    const y = ((K - 1n) * x + n / x ** (K - 1n)) / K;
    if (y >= x) {
      return x;
    }
    x = y;
  }
}

/** The low 32 bits of ⌊frac(p^(1/k)) × 2^32⌋, which is ⌊(p × 2^(32k))^(1/k)⌋ mod 2^32. */
const fractionBits = (p: number, k: 2 | 3): number =>
  Number(integerRoot(BigInt(p) << BigInt(32 * k), k) & 0xffffffffn);

const PRIMES = primes(64);
const H0 = Uint32Array.from(PRIMES.slice(0, 8), (p) => fractionBits(p, 2));
const K = Uint32Array.from(PRIMES, (p) => fractionBits(p, 3));

/** SHA-256 of `bytes` in JavaScript: the fallback, exported for its property test. */
export function sha256Js(bytes: Uint8Array): Uint8Array {
  const h = H0.slice();
  const w = new Uint32Array(64);
  const length = bytes.length;
  const fullBlocks = Math.floor(length / 64);
  for (let b = 0; b < fullBlocks; b++) {
    compress(h, w, bytes, b * 64);
  }

  // The tail, a 1 bit, zeros, and the message length in bits as a 64-bit
  // big-endian integer, in one or two final blocks.
  const rest = length - fullBlocks * 64;
  const tail = new Uint8Array(rest < 56 ? 64 : 128);
  tail.set(bytes.subarray(fullBlocks * 64));
  tail[rest] = 0x80;
  const view = new DataView(tail.buffer);
  view.setUint32(tail.length - 8, Math.floor(length / 0x20000000), false);
  view.setUint32(tail.length - 4, (length << 3) >>> 0, false);
  for (let at = 0; at < tail.length; at += 64) {
    compress(h, w, tail, at);
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    outView.setUint32(4 * i, h[i] as number, false);
  }
  return out;
}

/** One 64-byte block of `m` at `at` into the hash state `h`, with `w` as the schedule. */
function compress(h: Uint32Array, w: Uint32Array, m: Uint8Array, at: number): void {
  for (let t = 0; t < 16; t++) {
    const i = at + 4 * t;
    w[t] = (((m[i] as number) << 24) | ((m[i + 1] as number) << 16) | ((m[i + 2] as number) << 8) | (m[i + 3] as number)) >>> 0;
  }
  for (let t = 16; t < 64; t++) {
    const x = w[t - 15] as number;
    const y = w[t - 2] as number;
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[t] = ((w[t - 16] as number) + s0 + (w[t - 7] as number) + s1) >>> 0;
  }
  let a = h[0] as number;
  let b = h[1] as number;
  let c = h[2] as number;
  let d = h[3] as number;
  let e = h[4] as number;
  let f = h[5] as number;
  let g = h[6] as number;
  let hh = h[7] as number;
  for (let t = 0; t < 64; t++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (hh + S1 + ch + (K[t] as number) + (w[t] as number)) >>> 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) >>> 0;
    hh = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  h[0] = ((h[0] as number) + a) >>> 0;
  h[1] = ((h[1] as number) + b) >>> 0;
  h[2] = ((h[2] as number) + c) >>> 0;
  h[3] = ((h[3] as number) + d) >>> 0;
  h[4] = ((h[4] as number) + e) >>> 0;
  h[5] = ((h[5] as number) + f) >>> 0;
  h[6] = ((h[6] as number) + g) >>> 0;
  h[7] = ((h[7] as number) + hh) >>> 0;
}

/** `bytes` as lowercase hexadecimal. */
export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const byte of bytes) {
    s += byte.toString(16).padStart(2, '0');
  }
  return s;
}

/** The part of Web Crypto this module uses, where the runtime has it. */
interface SubtleDigest {
  digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
}

/** `crypto.subtle`, or `undefined` where the runtime or an insecure page has none. */
function subtle(): SubtleDigest | undefined {
  return (globalThis as { crypto?: { subtle?: SubtleDigest } }).crypto?.subtle;
}

/** The SHA-256 of `bytes` as 64 lowercase hex digits: by `crypto.subtle` where it exists, else in JavaScript. */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const webCrypto = subtle();
  if (webCrypto !== undefined) {
    return toHex(new Uint8Array(await webCrypto.digest('SHA-256', bytes)));
  }
  return toHex(sha256Js(bytes));
}
