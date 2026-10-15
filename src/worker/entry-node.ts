// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The Worker_Host's script under Node `worker_threads`: it serves the parent
// port. Built for ESM and CJS; `node-import.ts` and `node-require.ts` start
// it from the file next to them. It opens an Asset with the Node entry's
// `openAsset` (`node:zlib`).
//
// This is a new-design file: project header only.

import { parentPort } from 'node:worker_threads';

import { openAsset } from '../load/read-asset-node.js';

import type { Request } from './protocol.js';
import { serve } from './serve.js';

if (parentPort === null) {
  throw new Error('entry-node runs as a worker_threads worker');
}
const port = parentPort;
serve({
  onRequest: (handler) => port.on('message', (request: Request) => handler(request)),
  postReply: (reply) => port.postMessage(reply),
}, openAsset);
