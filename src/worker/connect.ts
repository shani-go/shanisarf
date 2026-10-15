// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The Worker_Client's call machinery: it sends `init` with the source, then
// one request per call, and settles each call on the reply with its id.
//
// - The source crosses as text, or as bytes (copied, or transferred when
//   asked: an `ArrayBuffer`, or a `Uint8Array` covering its whole buffer; any
//   other view is copied), or as a compiled Asset: the client reads it here,
//   on the caller's thread, with the entry's `readAsset` and the caller's
//   `manifestSha256`, so a tampered Manifest is refused before any Shard is
//   requested, and posts the Asset_Bytes with every buffer transferred. The
//   worker opens them and makes no request itself. The `init` reply's
//   Provenance becomes the WorkerAnalyzer's `provenance`.
// - Pending calls reject with `Error('worker terminated')` on `terminate()`
//   (or when a Node worker exits), and with the error on a worker `error`
//   event. A reply that fails to deserialize (`messageerror`) carries no id,
//   so it rejects every pending call rather than leave its own call waiting.
// - `lookup` sends its arguments as they are, and the worker's Lexicon checks
//   them, so a bad Lookup_Key or key rejects with the `TypeError` that
//   crosses back. A symbol or a function cannot cross structured clone at
//   all, so one given as `by` or `key` is refused here with a `TypeError`
//   instead of the clone's error.
// - A Node worker the entry started is unref'd while no call is pending, so
//   it does not keep the process alive by itself.
//
// Internal: the entries call it; the package exports `createWorkerAnalyzer`.
//
// This is a new-design file: project header only.

import type { Analysis, AnalyzedWord } from '../engine/analyzer.js';
import type { Provenance } from '../engine/database.js';
import type { GenerationFeatures } from '../engine/generator.js';
import type { LexiconEntry, LookupKey, LookupOptions } from '../engine/lexicon.js';
import type { AssetBytes } from '../load/open-asset.js';
import type { AssetSource, ReadOptions } from '../load/read-asset.js';

import type { CreateWorkerAnalyzerOptions, WorkerAnalyzer, WorkerHandle } from './client.js';
import { decodeError, type InitResult, type Reply, type Request, type Source } from './protocol.js';
import type { WebEvent } from './web-globals.js';

/** A `worker_threads` `Worker`, as much of it as is used. */
interface NodeWorker extends WorkerHandle {
  on(event: 'message' | 'error' | 'messageerror' | 'exit', listener: (value: unknown) => void): void;
  ref(): void;
  unref(): void;
}

/** A web `Worker`, as much of it as is used. */
interface WebWorker extends WorkerHandle {
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: WebEvent) => void): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

/** An entry's `readAsset`: the browser variant on the web entry, the Node variant on the Node entries. */
export type AssetReading = (source: AssetSource, options: ReadOptions) => Promise<AssetBytes>;

/** A request without its id; `connect` numbers it. */
type Call = Request extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

/**
 * Send `init` to `worker` and resolve with a {@link WorkerAnalyzer} once the
 * worker has built its model and Analyzer. `owned` marks a worker the entry
 * started: it is terminated when `init` fails, and a Node one is unref'd
 * while idle. `readAsset` reads an Asset source on this thread.
 */
export function connect(
  worker: WorkerHandle,
  owned: boolean,
  options: CreateWorkerAnalyzerOptions,
  readAsset: AssetReading,
): Promise<WorkerAnalyzer> {
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let closed: Error | null = null;
  let provenance: Readonly<Provenance> | null = null;

  const node = typeof (worker as Partial<NodeWorker>).on === 'function' ? (worker as NodeWorker) : null;
  const idle = (): void => {
    if (owned && node !== null) {
      if (pending.size === 0) {
        node.unref();
      } else {
        node.ref();
      }
    }
  };
  const failAll = (error: unknown): void => {
    const calls = [...pending.values()];
    pending.clear();
    idle();
    for (const call of calls) {
      call.reject(error);
    }
  };
  const onReply = (reply: Reply): void => {
    const call = pending.get(reply.id);
    if (call === undefined) {
      return;
    }
    pending.delete(reply.id);
    idle();
    if (reply.ok) {
      call.resolve(reply.value);
    } else {
      call.reject(decodeError(reply.error));
    }
  };
  const asError = (value: unknown, fallback: string): Error =>
    value instanceof Error ? value : new Error(typeof value === 'string' && value !== '' ? value : fallback);

  if (node !== null) {
    node.on('message', (value) => onReply(value as Reply));
    node.on('error', (error) => failAll(asError(error, 'worker error')));
    node.on('messageerror', (error) => failAll(asError(error, 'a worker reply could not be deserialized')));
    node.on('exit', () => {
      closed ??= new Error('worker terminated');
      failAll(closed);
    });
  } else {
    const web = worker as WebWorker;
    web.addEventListener('message', (event) => onReply(event.data as Reply));
    web.addEventListener('error', (event) => failAll(asError(event.error ?? event.message, 'worker error')));
    web.addEventListener('messageerror', () => failAll(new Error('a worker reply could not be deserialized')));
  }

  const call = <T>(request: Call, transfer: ArrayBuffer[] = []): Promise<T> => {
    if (closed !== null) {
      return Promise.reject(closed);
    }
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      idle();
      try {
        worker.postMessage({ ...request, id } as Request, transfer);
      } catch (error) {
        pending.delete(id);
        idle();
        reject(error);
      }
    });
  };

  const analyzer: WorkerAnalyzer = {
    get provenance() {
      return provenance;
    },
    analyze: (word: string) => call<Analysis[]>({ op: 'analyze', word }),
    analyzeWords: (words: readonly string[]) => call<AnalyzedWord[]>({ op: 'analyzeWords', words }),
    generate: (lemma: string, feats: GenerationFeatures) => call<Analysis[]>({ op: 'generate', lemma, feats }),
    reinflect: (word: string, feats: GenerationFeatures) => call<Analysis[]>({ op: 'reinflect', word, feats }),
    allFeats: () => call<Set<string>>({ op: 'allFeats' }),
    tokFeats: () => call<Set<string>>({ op: 'tokFeats' }),
    lookup: (by: LookupKey, key: string, options?: LookupOptions) => {
      const uncloneable = [by, key].find((v: unknown) => typeof v === 'symbol' || typeof v === 'function');
      if (uncloneable !== undefined) {
        return Promise.reject(new TypeError(`lookup: by and key cannot be a ${typeof uncloneable}`));
      }
      return call<LexiconEntry[]>(options === undefined ? { op: 'lookup', by, key } : { op: 'lookup', by, key, options });
    },
    terminate: async () => {
      closed ??= new Error('worker terminated');
      failAll(closed);
      await worker.terminate();
    },
  };

  idle();
  return sourceOf(options, readAsset)
    .then((source) =>
      call<InitResult>(
        { op: 'init', source: source.source, flags: options.flags ?? 'a', analyzer: options.analyzer ?? {} },
        source.transfer,
      ),
    )
    .then(
      (result) => {
        provenance = frozen(result.provenance);
        return analyzer;
      },
      async (error: unknown) => {
        if (owned) {
          await analyzer.terminate();
        }
        throw error;
      },
    );
}

/** A Provenance that crossed structured clone, frozen again, its license too. */
function frozen(p: Provenance | null): Readonly<Provenance> | null {
  return p === null ? null : Object.freeze({ ...p, license: Object.freeze({ ...p.license }) });
}

/** The `init` source, and what to transfer with it; an Asset source is read here first. */
async function sourceOf(
  options: CreateWorkerAnalyzerOptions,
  readAsset: AssetReading,
): Promise<{ source: Source; transfer: ArrayBuffer[] }> {
  const { source } = options;
  if (typeof source === 'object' && source !== null && !(source instanceof ArrayBuffer) && !ArrayBuffer.isView(source)) {
    if (!('asset' in source)) {
      throw new TypeError('createWorkerAnalyzer: an object source must be { asset, manifestSha256? }');
    }
    const { asset, manifestSha256 } = source;
    const bytes = await readAsset(asset, manifestSha256 === undefined ? {} : { manifestSha256 });
    // readAsset returns fresh buffers that nothing else holds: transfer them all.
    const buffers = new Set<ArrayBuffer>([bytes.manifest.buffer as ArrayBuffer]);
    for (const shard of Object.values(bytes.shards)) {
      buffers.add(shard.buffer as ArrayBuffer);
    }
    return {
      source: manifestSha256 === undefined ? { kind: 'asset', asset: bytes } : { kind: 'asset', asset: bytes, manifestSha256 },
      transfer: [...buffers],
    };
  }
  const transfer = options.transfer === true;
  if (typeof source === 'string') {
    return { source: { kind: 'text', text: source }, transfer: [] };
  }
  if (source instanceof ArrayBuffer) {
    return { source: { kind: 'bytes', bytes: source }, transfer: transfer ? [source] : [] };
  }
  if (source instanceof Uint8Array) {
    const buffer = source.buffer;
    const whole = buffer instanceof ArrayBuffer && source.byteOffset === 0 && source.byteLength === buffer.byteLength;
    if (whole) {
      return { source: { kind: 'bytes', bytes: buffer }, transfer: transfer ? [buffer] : [] };
    }
    // Part of a buffer, or a shared one: send a copy of the view, which
    // nothing else holds.
    const copy = source.slice().buffer as ArrayBuffer;
    return { source: { kind: 'bytes', bytes: copy }, transfer: [copy] };
  }
  throw new TypeError('createWorkerAnalyzer: source must be an ArrayBuffer, a Uint8Array, a string or { asset }');
}
