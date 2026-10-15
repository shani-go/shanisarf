// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The `shanisarf/compile` surface: the compiler, Node only. It turns any
// ALMOR database and a Source_Record describing it into an Asset that
// `loadDatabase` opens. The package exports it under a `node` condition with
// no `default`, so a browser bundler fails to resolve it instead of bundling
// `node:fs`.
//
// This is a new-design file: project header only.

export {
  compileDatabase,
  compileDatabaseFile,
  writeAsset,
  type CompileOptions,
  type CompiledAsset,
} from './compile-database.js';
export { parseSourceRecord, type SourceRecord } from './source-record.js';
export { SourceRecordError } from '../load/errors.js';
