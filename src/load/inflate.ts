// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Inflating a Shard. `inflate(stored, size, path)` pipes the Stored_Bytes
// through `DecompressionStream('deflate')`, the zlib format, which every
// evergreen browser, Node 20 and later, Deno and Bun provide, and reads its
// output in chunks into one buffer of the Manifest's `size`. It stops as soon
// as the output would exceed `size` (so a decompression bomb costs at most
// `size` bytes), and fails if it ends short. A truncated or corrupt stream
// fails in the decompressor, whose zlib trailer carries an Adler-32 check;
// that failure surfaces as `AssetIntegrityError` too.
//
// A server that sends a `.bin` file with a `Content-Encoding` the browser
// undoes hands the loader the Shard_Content itself. `isContainer` tests for
// the Container magic, which no zlib stream begins with, so callers skip
// inflating those bytes; the SHA-256 check that follows is unchanged.
//
// The Node entry inflates with `node:zlib` instead (`inflate-node.ts`).
//
// This is a new-design file: project header only.

import { AssetIntegrityError } from './errors.js';

export { isContainer } from './shard-container.js';

/** Inflates `stored` into exactly `size` bytes, naming `path` in its errors. */
export type Inflate = (stored: Uint8Array, size: number, path: string) => Promise<Uint8Array>;

/** The error for an inflated length other than `size`. */
export function sizeError(path: string, size: number, actual: string): AssetIntegrityError {
  return new AssetIntegrityError(
    `${path}: inflated to ${actual} bytes, but the Manifest gives ${size}`,
    path,
    String(size),
    actual,
  );
}

/** The error for a stream the decompressor refused. */
export function streamError(path: string, cause: unknown): AssetIntegrityError {
  const detail = cause instanceof Error && cause.message !== '' ? cause.message : String((cause as { code?: unknown })?.code ?? cause);
  return new AssetIntegrityError(
    `${path}: the compressed stream is corrupt or truncated (${detail})`,
    path,
    'a zlib deflate stream',
    'a corrupt or truncated stream',
    { cause },
  );
}

/**
 * `stored` inflated through `DecompressionStream('deflate')` into a new
 * buffer of exactly `size` bytes.
 *
 * @throws {AssetIntegrityError} when the output would exceed `size`, ends
 *   short of it, or the stream is corrupt or truncated.
 */
export async function inflate(stored: Uint8Array, size: number, path: string): Promise<Uint8Array> {
  const out = new Uint8Array(size);
  let at = 0;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(stored);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream('deflate')).getReader();
  for (;;) {
    let chunk: Awaited<ReturnType<typeof reader.read>>;
    try {
      chunk = await reader.read();
    } catch (e) {
      throw streamError(path, e);
    }
    if (chunk.done) {
      break;
    }
    const bytes = chunk.value;
    if (at + bytes.length > size) {
      await reader.cancel().catch(() => undefined);
      throw sizeError(path, size, `more than ${size}`);
    }
    out.set(bytes, at);
    at += bytes.length;
  }
  if (at !== size) {
    throw sizeError(path, size, String(at));
  }
  return out;
}
