// Ported from CAMeL Tools camel_tools/morphology/reinflector.py (version 1.6.0).
// Copyright 2018-2026 New York University Abu Dhabi. MIT License.
// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.
// shanisarf's changes are Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
//
// The reinflector. `new Reinflector(db)` over a model parsed with `r`;
// `reinflect(word, feats)` analyzes `word`, keeps the analyses whose
// diacritized form dediacritizes to the word, turns each into a generation
// request with `feats` applied, and returns the generated analyses without
// exact duplicates. The steps follow upstream's `Reinflector.reinflect` in
// order:
//
//   (a) analyze first; no analysis returns `[]` before any validation;
//   (b) validate the request, `'ANY'` passing for an `ANY_FEATS` key;
//   (c)–(e) filter each analysis and build its generation request over the
//       analysis's keys in order;
//   (f) generate, letting a generator error propagate;
//   (g) dedupe by ordered entries, keeping the first occurrence.
//
// Upstream returns its deduplicated `set` in hash order; the port keeps the
// first occurrence, so its order is defined, and parity is compared in
// Canonical_Order.

import { Analyzer, type Analysis } from './analyzer.js';
import { MorphologyDb } from './database.js';
import { dediacAr } from './dediac.js';
import {
  InvalidReinflectorFeature,
  InvalidReinflectorFeatureValue,
  ReinflectorError,
} from './errors.js';
import { stripLex } from './features.js';
import { type GenerationFeatures, Generator } from './generator.js';

/** Upstream `_CLITIC_FEATS`: requesting any of these drops `CLITIC_IGNORED_FEATS`. */
export const CLITIC_FEATS: ReadonlySet<string> = new Set([
  'enc0', 'prc0', 'prc1', 'prc2', 'prc3',
]);

/** Upstream `_IGNORED_FEATS` (28 names): never copied into a generation request. */
export const IGNORED_FEATS: ReadonlySet<string> = new Set([
  'diac', 'lex', 'bw', 'gloss', 'source', 'stem', 'stemcat', 'lmm', 'dediac',
  'caphi', 'catib6', 'ud', 'd3seg', 'atbseg', 'd2seg', 'd1seg', 'd1tok',
  'd2tok', 'atbtok', 'd3tok', 'bwtok', 'root', 'pattern', 'freq',
  'pos_logprob', 'lex_logprob', 'pos_lex_logprob', 'stemgloss',
]);

/** Upstream `_SPECIFIED_FEATS`: copied only when requested. */
export const SPECIFIED_FEATS: ReadonlySet<string> = new Set(['form_gen', 'form_num']);

/** Upstream `_CLITIC_IGNORED_FEATS`: dropped when a clitic is requested. */
export const CLITIC_IGNORED_FEATS: ReadonlySet<string> = new Set(['stt', 'cas', 'mod']);

/** Upstream `_ANY_FEATS`: the features that accept the value `'ANY'`. */
export const ANY_FEATS: ReadonlySet<string> = new Set([
  'per', 'gen', 'num', 'cas', 'stt', 'vox', 'mod', 'asp',
]);

// Upstream also defines `_FILTER_FEATS = frozenset(['pos', 'lex'])` and never
// reads it; it is not ported. Upstream's `_LEMMA_SPLIT_RE` (`-|_`) splits as
// `stripLex` does, so `stripLex` stands in for it.

/** Python's `key in dict` for a plain record. */
function has(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Morphological reinflector over a model parsed with `r` (or `ag`).
 */
export class Reinflector {
  private readonly db: MorphologyDb;
  private readonly analyzer: Analyzer;
  private readonly generator: Generator;

  /**
   * In upstream's order: a non-model, then a model without generation, are
   * `ReinflectorError`s; then the default-option `Analyzer` is built (an
   * `AnalyzerError` on a `g`-only model), then the `Generator`.
   */
  constructor(db: MorphologyDb) {
    if (!(db instanceof MorphologyDb)) {
      throw new ReinflectorError('DB is not an instance of MorphologyDB');
    }
    // Upstream tests `db.flags.generation`, not `reinflection`.
    if (!db.flags.generation) {
      throw new ReinflectorError('DB does not support reinflection');
    }
    this.db = db;
    this.analyzer = new Analyzer(db);
    this.generator = new Generator(db);
  }

  /**
   * Reinflect `word` to the features in `feats`; the surface form of each
   * result is its `diac`.
   *
   * @throws {InvalidReinflectorFeature} for a key the database does not
   *   define.
   * @throws {InvalidReinflectorFeatureValue} for a value outside a closed
   *   define (other than `'ANY'` on an `ANY_FEATS` key).
   * @throws the generator's errors, unchanged, as upstream lets them through.
   */
  reinflect(word: string, feats: GenerationFeatures): Analysis[] {
    const db = this.db;

    // (a) Analysis comes before validation.
    const analyses = this.analyzer.analyze(word);
    if (analyses.length === 0) {
      return [];
    }

    // (b) Validation in insertion order.
    for (const feat of Object.keys(feats)) {
      if (!db.defines.has(feat)) {
        throw new InvalidReinflectorFeature(feat);
      }
      const values = db.defines.get(feat) as string[] | null;
      if (values !== null) {
        const value = feats[feat] as string;
        if (ANY_FEATS.has(feat) && value === 'ANY') {
          continue;
        }
        if (!values.includes(value)) {
          throw new InvalidReinflectorFeatureValue(feat, value);
        }
      }
    }

    // (c)
    let hasClitics = false;
    for (const feat of CLITIC_FEATS) {
      if (has(feats, feat)) {
        hasClitics = true;
        break;
      }
    }

    // `word` is not stripped here, as upstream: a word with surrounding
    // whitespace analyzes, but no analysis's `diac` dediacritizes to it.
    const wordDediac = dediacAr(word);
    const results: Analysis[] = [];

    for (const analysis of analyses) {
      // (d) Upstream reads `analysis['diac']` and `analysis['lex']` directly;
      // an analysis without either is skipped here. The Analyzer always sets
      // both.
      const diac = analysis['diac'];
      const lex = analysis['lex'];
      if (typeof diac !== 'string' || typeof lex !== 'string') {
        continue;
      }
      if (dediacAr(diac) !== wordDediac) {
        continue;
      }
      if (has(feats, 'pos') && feats['pos'] !== analysis['pos']) {
        continue;
      }
      const lemma = stripLex(lex);
      if (has(feats, 'lex') && feats['lex'] !== lemma) {
        continue;
      }

      // (e) The generation request, over the analysis's keys in order.
      let isValid = true;
      const generateFeats: Record<string, string | null> = {};
      for (const feat of Object.keys(analysis)) {
        if (IGNORED_FEATS.has(feat)) {
          continue;
        } else if (SPECIFIED_FEATS.has(feat) && !has(feats, feat)) {
          continue;
        } else if (hasClitics && CLITIC_IGNORED_FEATS.has(feat)) {
          continue;
        } else if (has(feats, feat)) {
          if (feats[feat] === 'ANY') {
            continue;
          } else if (analysis[feat] !== 'na') {
            generateFeats[feat] = feats[feat] as string;
          } else {
            isValid = false;
            break;
          }
        } else if (analysis[feat] !== 'na') {
          // A special-path analysis may carry `null` here, as upstream's
          // `None`; only the log-probabilities are numbers, and they are
          // ignored above.
          generateFeats[feat] = analysis[feat] as string | null;
        }
      }

      // (f)
      if (isValid) {
        results.push(...this.generator.generate(lemma, generateFeats));
      }
    }

    // (g) Upstream: `[dict(y) for y in set(tuple(x.items()) for x in
    // results)]`. The key is the ordered entries, not the Canonical_Key: two
    // results equal as dictionaries but with different key orders both
    // survive, as upstream's.
    const seen = new Set<string>();
    const unique: Analysis[] = [];
    for (const result of results) {
      const key = JSON.stringify(Object.entries(result));
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(result);
      }
    }
    return unique;
  }

  /** The feature names the database defines (upstream `all_feats()`). */
  allFeats(): Set<string> {
    return this.db.allFeats();
  }

  /** The tokenization feature names (upstream `tok_feats()`). */
  tokFeats(): Set<string> {
    return this.db.tokFeats();
  }
}
