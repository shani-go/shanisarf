// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// `shanisarf/worker` under Node's `require`. CJS only: it starts
// `entry-node.js` next to it under `worker_threads`, located with
// `__dirname`. An Asset source is read here with the Node entry's `readAsset`
// (paths, `file:` URLs, `fetch`).
//
// This is a new-design file: project header only.

import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { readAsset } from '../load/read-asset-node.js';

import type { CreateWorkerAnalyzerOptions, WorkerAnalyzer } from './client.js';
import { connect } from './connect.js';

export type {
  CreateWorkerAnalyzerOptions,
  WorkerAnalyzer,
  WorkerAnalyzerOptions,
  WorkerAssetSource,
  WorkerHandle,
} from './client.js';

/** See `client.ts`: start the worker next to this file, or the `worker` given. */
export function createWorkerAnalyzer(options: CreateWorkerAnalyzerOptions): Promise<WorkerAnalyzer> {
  const { worker } = options;
  if (typeof worker === 'object' && !(worker instanceof URL)) {
    return connect(worker, false, options, readAsset);
  }
  const started = new Worker(worker ?? join(__dirname, 'entry-node.js'));
  return connect(started, true, options, readAsset);
}
