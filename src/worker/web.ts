// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// `shanisarf/worker` for browsers, Deno and Bun (the `default` condition).
// ESM only: it starts the module worker next to it with
// `new URL('./entry-web.js', import.meta.url)`, written out in full so that
// bundlers find and bundle the worker script. An Asset source is read here,
// on the page's thread, with the browser entry's `readAsset` (`fetch` or a
// reader function).
//
// This is a new-design file: project header only.

import { readAsset } from '../load/read-asset.js';

import type { CreateWorkerAnalyzerOptions, WorkerAnalyzer } from './client.js';
import { connect } from './connect.js';
import type { WebWorkerConstructor } from './web-globals.js';

export type {
  CreateWorkerAnalyzerOptions,
  WorkerAnalyzer,
  WorkerAnalyzerOptions,
  WorkerAssetSource,
  WorkerHandle,
} from './client.js';

declare const Worker: WebWorkerConstructor | undefined;

/** See `client.ts`: start the module worker next to this file, or the `worker` given. */
export function createWorkerAnalyzer(options: CreateWorkerAnalyzerOptions): Promise<WorkerAnalyzer> {
  const { worker } = options;
  if (typeof worker === 'object' && !(worker instanceof URL)) {
    return connect(worker, false, options, readAsset);
  }
  if (typeof Worker === 'undefined') {
    return Promise.reject(new TypeError('this runtime has no Worker: use the in-thread Analyzer'));
  }
  const started =
    worker === undefined
      ? new Worker(new URL('./entry-web.js', import.meta.url), { type: 'module' })
      : new Worker(worker, { type: 'module' });
  return connect(started, true, options, readAsset);
}
