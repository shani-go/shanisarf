// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The Worker_Client's API: the types every `shanisarf/worker` entry exports,
// and `createWorkerAnalyzer` for a worker the caller has started. The
// package's `./worker` types point here. The entries (`web.ts`,
// `node-import.ts`, `node-require.ts`) export the same function, which also
// starts the worker from the script next to them or from a URL; the call
// machinery is `connect.ts`.
//
// The worker makes no request. With an Asset source, the caller's thread
// reads the Asset, as `readAsset` reads it, and the worker opens the bytes it
// is sent: the client may read the Asset its caller names.
//
// This is a new-design file: project header only.

import type { Analysis, AnalyzedWord } from '../engine/analyzer.js';
import type { Provenance } from '../engine/database.js';
import type { GenerationFeatures } from '../engine/generator.js';
import type { LexiconEntry, LookupKey, LookupOptions } from '../engine/lexicon.js';
import { type AssetSource, readAsset } from '../load/read-asset.js';

import { connect } from './connect.js';
import type { WorkerAnalyzerOptions } from './protocol.js';

export type { WorkerAnalyzerOptions } from './protocol.js';

/**
 * A started worker: a web `Worker` on the web entry, a `worker_threads`
 * `Worker` on the Node entries. Only these members are named; the client
 * also listens for its messages and errors.
 */
export interface WorkerHandle {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  terminate(): unknown;
}

/**
 * A compiled Asset as a worker's source: where it is (a URL, its string, in
 * Node also a path, or a reader function, as `readAsset` takes them), and
 * the Asset_Digest it must have.
 */
export interface WorkerAssetSource {
  asset: AssetSource;
  /** The SHA-256 of the Asset's Manifest, 64 hex digits; checked before any Shard is read, and again in the worker. */
  manifestSha256?: string;
}

/** {@link createWorkerAnalyzer}'s options. */
export interface CreateWorkerAnalyzerOptions {
  /**
   * The database: UTF-8 ALMOR_Text bytes or the text itself, parsed in the
   * worker; or a compiled Asset, read on this thread and opened in the
   * worker.
   */
  source: ArrayBuffer | Uint8Array | string | WorkerAssetSource;
  /** The flags, `'a'` by default (the parse flags, or `openAsset`'s). */
  flags?: string;
  /** The worker's Analyzer options; `normMap` crosses as `'default'`, `null` or a `CharMap` specification. */
  analyzer?: WorkerAnalyzerOptions;
  /**
   * Transfer the source instead of copying it: an `ArrayBuffer`, or a
   * `Uint8Array` covering its whole buffer, becomes detached. Any other view
   * is copied. `false` by default. An Asset's bytes, read for the worker, are
   * always transferred.
   */
  transfer?: boolean;
  /**
   * The worker to use instead of the one next to this module: a started
   * worker, or the URL of the worker script (`entry-web.js` or
   * `entry-node.js`, wherever the caller serves it).
   */
  worker?: WorkerHandle | URL | string;
}

/**
 * An Analyzer, with a Generator and a Reinflector built on first use, in a
 * worker. Every call is one message each way and settles on its own reply;
 * calls may overlap. Each result is a copy made by structured clone, with the
 * same keys in the same order and the same values as the in-thread result,
 * so the in-thread aliasing contract (a cached result is shared) does not
 * cross: a result can be changed freely. Errors arrive as the engine's own
 * classes, with the same `name`, `message` and fields.
 */
export interface WorkerAnalyzer {
  /** The database's Provenance for an Asset source (show its `credits` with results); `null` for text or bytes. */
  readonly provenance: Readonly<Provenance> | null;
  analyze(word: string): Promise<Analysis[]>;
  /** The whole list in one message, all results in one reply, in input order. */
  analyzeWords(words: readonly string[]): Promise<AnalyzedWord[]>;
  generate(lemma: string, feats: GenerationFeatures): Promise<Analysis[]>;
  reinflect(word: string, feats: GenerationFeatures): Promise<Analysis[]>;
  allFeats(): Promise<Set<string>>;
  tokFeats(): Promise<Set<string>>;
  /**
   * A Lexicon lookup in the worker: the stem entries whose `by` key is
   * `key`, in line order, as `Lexicon.lookup` returns them. The worker
   * builds one Lexicon on the first call and keeps it. Ask for a `features`
   * subset to keep the reply small. Rejects with `TypeError` for a bad `by`
   * or a non-string `key`.
   */
  lookup(by: LookupKey, key: string, options?: LookupOptions): Promise<LexiconEntry[]>;
  /** End the worker; pending and later calls reject with `Error('worker terminated')`. */
  terminate(): Promise<void>;
}

/**
 * Build a model and an Analyzer in a worker. Resolves once both are built,
 * and rejects with the engine's own error otherwise (a malformed database,
 * an invalid flag, an invalid option, an asset error).
 *
 * The worker is the script next to the `shanisarf/worker` entry, or the
 * `worker` the caller supplies. Nothing else is loaded, and the worker makes
 * no request: the database reaches it in the message. For an Asset source,
 * this thread reads the Manifest and the Shards it names, and nothing else.
 * A runtime without a `Worker` (some edge functions) should use the
 * in-thread `Analyzer`.
 *
 * @throws {TypeError} in this module, unless `worker` is a started worker;
 *   the `shanisarf/worker` entries also start one.
 */
export function createWorkerAnalyzer(options: CreateWorkerAnalyzerOptions): Promise<WorkerAnalyzer> {
  const { worker } = options;
  if (typeof worker !== 'object' || worker instanceof URL) {
    return Promise.reject(new TypeError('createWorkerAnalyzer: import it from shanisarf/worker to start a worker'));
  }
  return connect(worker, false, options, readAsset);
}
