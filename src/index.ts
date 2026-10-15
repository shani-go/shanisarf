// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Package root, browser entry (the `import` and `require` targets of `.`
// without the `node` condition). Re-exports the engine's public entry
// (src/engine/index.ts) and the loader: `loadDatabase`, `readAsset` and
// `openAsset`, their types and the asset errors. A string source is a URL,
// and `openAsset` inflates through `DecompressionStream`; nothing reachable
// from here imports a `node:` module. Node resolves `.` to `index-node.ts`
// instead.
// The alignment surface (src/align/) is re-exported beside the engine; it
// imports only engine modules. So is the generated typed features module
// (src/msa-features.ts), which describes the pin and is not on the engine
// entry.
export * from './engine/index.js';
export * from './align/index.js';
export * from './msa-features.js';
export * from './load/index.js';
