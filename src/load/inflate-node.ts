// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Inflating a Shard in Node: `node:zlib`'s `inflate` with
// `maxOutputLength: size + 1`, which a probe measured at about a third of
// `DecompressionStream`'s time. It fails as the stream variant does
// (`inflate.ts`): an output past `size` or short of it, a corrupt or
// truncated stream, and bytes after the end of the stream, which `node:zlib`
// would otherwise ignore, are each an `AssetIntegrityError`. Only the Node
// entries reach this module.
//
// This is a new-design file: project header only.

import { inflate as zlibInflate, type ZlibOptions } from 'node:zlib';

import { sizeError, streamError } from './inflate.js';

interface InflateInfo {
  buffer: Buffer;
  engine: { bytesWritten: number };
}

/**
 * `stored` inflated with `node:zlib` into exactly `size` bytes.
 *
 * @throws {AssetIntegrityError} when the output would exceed `size`, ends
 *   short of it, the stream is corrupt or truncated, or bytes follow it.
 */
export async function inflateNode(stored: Uint8Array, size: number, path: string): Promise<Uint8Array> {
  const options: ZlibOptions & { info: true } = { info: true, maxOutputLength: size + 1 };
  const result = await new Promise<InflateInfo>((resolve, reject) => {
    zlibInflate(stored, options, (error, value) => {
      if (error !== null) {
        reject(error);
      } else {
        resolve(value as unknown as InflateInfo);
      }
    });
  }).catch((error: unknown) => {
    throw (error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE'
      ? sizeError(path, size, `more than ${size}`)
      : streamError(path, error);
  });
  if (result.engine.bytesWritten !== stored.length) {
    throw streamError(path, new Error(`${stored.length - result.engine.bytesWritten} bytes follow the end of the stream`));
  }
  if (result.buffer.length !== size) {
    // At most `size + 1` bytes come out, so a longer result is an overrun,
    // reported as the stream variant reports it.
    throw sizeError(path, size, result.buffer.length > size ? `more than ${size}` : String(result.buffer.length));
  }
  return new Uint8Array(result.buffer.buffer, result.buffer.byteOffset, result.buffer.byteLength);
}
