// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Package root, Node entry (the `node` condition of `.`). The same names as
// the browser entry (`index.ts`), with `loadDatabase`, `readAsset` and
// `openAsset` from the Node variant: a string source may also be a path or a
// `file:` URL, read with `node:fs/promises`, and `openAsset` inflates with
// `node:zlib`. Both entries share one declaration file (`dist/index.d.ts`).
// The alignment surface (src/align/) is re-exported beside the engine; it
// imports only engine modules. So is the generated typed features module
// (src/msa-features.ts), which describes the pin and is not on the engine
// entry.
export * from './engine/index.js';
export * from './align/index.js';
export * from './msa-features.js';
export * from './load/index-node.js';
