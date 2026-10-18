# Changelog

What each published version of `shanisarf` changes. The release runbook
(`docs/npm-release.md`) turns "Unreleased" into a dated entry when a
version is published.

## 0.1.0 (2026-10-17)

The first release.

- **Analysis.** `Analyzer`, a TypeScript port of the CAMeL Tools 1.6.0
  analysis core, with its backoff modes and an optional analysis cache
  (`cacheSize`, off by default). It returns what CAMeL Tools returns over
  the Camel Morph MSA v1.0 database, proven by fixtures generated from the
  Python implementation and replayed against the port.
- **Generation.** `Generator` and `Reinflector`, ported and at parity.
- **Text utilities.** `simpleWordTokenize`, `CharMapper` and the twenty-one
  built-in character maps, `Transliterator`, and the dediacritization,
  normalization and character-set functions.
- **Loading.** `loadDatabase`, `readAsset` and `openAsset` read a compiled
  asset from a URL, a path, a `file:` URL or a function, and check every
  shard's SHA-256 and every table's structure before opening it. A pinned
  `manifestSha256` refuses any other asset. Failures are typed:
  `AssetReadError`, `AssetIntegrityError` and `AssetFormatError`.
  `parseAlmor` still reads ALMOR text directly.
- **Compiling.** `shanisarf/compile` (Node only) compiles an ALMOR database
  and its Source_Record into an asset whose manifest carries the license,
  credits, citation and disclaimer.
- **Worker.** `shanisarf/worker` runs the analyzer in a Web Worker in
  browsers and under `worker_threads` in Node, behind one promise API.
- **Lexicon.** `Lexicon` looks up stem entries by lemma, stem or root,
  exactly or after `foldArabicKey`.
- **Alignment.** `cliticSegments`, `placeMarks` and `agreedMarks` carry an
  analysis back to the word as it was written.
- **Typed features.** The Camel Morph MSA feature names and closed value
  sets as constants and types (`MSA_FEATURE_NAMES`, `MSA_DEFINES`,
  `MsaAnalysis`, `isMsaValue`).
- **Packaging.** ESM and CommonJS builds with type declarations, no runtime
  dependencies, Node 20 or later and evergreen browsers. The package ships
  `NOTICE` and the upstream licenses under `licenses/`. The database ships
  separately, as `shanisarf-db-msa` 1.0.0 (asset format version 1).
