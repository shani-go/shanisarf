// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The loader's surface for the browser entry: `loadDatabase`, `readAsset` and
// `openAsset`, their types, and the asset errors. `openAsset` inflates
// through `DecompressionStream`, and a string source is a URL. Nothing here
// reaches a `node:` module.
//
// This is a new-design file: project header only.

export { type AssetBytes, type OpenOptions, openAsset } from './open-asset.js';
export {
  type AssetReader,
  type AssetSource,
  type LoadOptions,
  loadDatabase,
  type ReadOptions,
  readAsset,
} from './read-asset.js';
export {
  AssetError,
  type AssetErrorOptions,
  AssetFormatError,
  AssetIntegrityError,
  AssetReadError,
  SourceRecordError,
} from './errors.js';
