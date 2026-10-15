// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The Worker_Host's script in a web module worker: it serves the worker's
// global scope. ESM only; `web.ts` starts it from the file next to it. It
// opens an Asset with the browser entry's `openAsset`
// (`DecompressionStream`).
//
// This is a new-design file: project header only.

import { openAsset } from '../load/open-asset.js';

import type { Request } from './protocol.js';
import { serve } from './serve.js';
import type { WebWorkerScope } from './web-globals.js';

declare const self: WebWorkerScope;

serve({
  onRequest: (handler) => self.addEventListener('message', (event) => handler(event.data as Request)),
  postReply: (reply) => self.postMessage(reply),
}, openAsset);
