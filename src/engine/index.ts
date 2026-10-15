// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Public entry for the engine. Re-exports the analysis surface: the ALMOR
// parser and serializer, the Analyzer and its default normalization map, the
// Generator and Reinflector, the public types, the CharMapper and
// Transliterator, the dediacritization and normalization functions, the word
// tokenizer, the character sets and the error classes. It deliberately does
// NOT export `loadDatabase` — loading is the loaders' concern (`src/load/`),
// not the engine's. This is a new-design file: project header only, no
// ported-code notice.

// ALMOR database: parser, serializer and model.
export { parseAlmor, type ParseAlmorOptions } from './almor-parser.js';
export { serializeAlmor } from './almor-serializer.js';
export { MorphologyDb, type Entry, type DatabaseFlags, type Provenance } from './database.js';

// The analyzer, its options, result shapes and the default normalization map.
export {
  Analyzer,
  DEFAULT_NORMALIZE_MAP,
  BACKOFF_MODES,
  type Analysis,
  type AnalyzedWord,
  type AnalyzerOptions,
  type BackoffMode,
} from './analyzer.js';

// The generator and reinflector. Their six error classes come with `errors.js`
// below.
export { Generator, type GenerationFeatures } from './generator.js';
export { Reinflector } from './reinflector.js';

// Character mapping and marker-aware transliteration.
export { CharMapper, type CharMap } from './charmap.js';
export { Transliterator } from './transliterator.js';

// Lexicon lookups and the key Fold. `stripLex` is upstream's `strip_lex`, for
// callers with a raw lemma string; a stored `lex` is already stripped. The
// test-facing `lexiconIndexesOf` reader is deliberately left out.
export { stripLex } from './features.js';
export { foldArabicKey } from './key-fold.js';
export { Lexicon, type LexiconEntry, type LookupKey, type LookupOptions } from './lexicon.js';

// The word tokenizer.
export { simpleWordTokenize, EMOJI_APPROXIMATION_BOUND } from './word-tokenizer.js';

// Dediacritization, normalization, the character sets and the error classes
// are re-exported whole; each module's public surface is the engine's.
export * from './dediac.js';
export * from './normalize.js';
export * from './charsets.js';
export * from './errors.js';
