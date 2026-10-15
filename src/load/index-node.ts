// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The loader's surface for the Node entry: the same names as `index.ts`, with
// `loadDatabase`, `readAsset` and `openAsset` from the Node variant, which
// also reads paths and `file:` URLs and inflates with `node:zlib`.
//
// This is a new-design file: project header only.

export { type AssetBytes, type OpenOptions } from './open-asset.js';
export {
  type AssetReader,
  type AssetSource,
  type LoadOptions,
  type ReadOptions,
} from './read-asset.js';
export { loadDatabase, openAsset, readAsset } from './read-asset-node.js';
export {
  AssetError,
  type AssetErrorOptions,
  AssetFormatError,
  AssetIntegrityError,
  AssetReadError,
  SourceRecordError,
} from './errors.js';
