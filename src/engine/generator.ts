// Ported from CAMeL Tools camel_tools/morphology/generator.py (version 1.6.0).
// Copyright 2018-2026 New York University Abu Dhabi. MIT License.
// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.
// shanisarf's changes are Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
//
// The generator. `new Generator(db)` over a model parsed with `g` or `r`;
// `generate(lemma, feats)` returns the analyses of every inflected form of
// `lemma` that agrees with the (possibly underspecified) feature request, in
// loop order. The steps follow upstream's `Generator.generate` in order:
//
//   (a) strip the lemma; an unknown lemma returns `[]` before any validation;
//   (b) validate each requested key in insertion order, then (c) `pos`;
//   (d) the `DEFAULTS`-row subset test, then the clitic default fill;
//   (e) the stem filter over each stem's Stem_View;
//   (f) the prefix filter, (g) the suffix filter with the AC test;
//   (h) the merge (upstream `merge_features`) and the final agreement filter.
//
// The generator reads the tuple model: the lemma's stems from the lemma index
// in line order; the Stem_View's values for the filters from the stem's Tuple,
// with `stemcat` from its role name; the prefix categories from AB transposed
// and the suffix categories from BC, in line order; the affix records' values
// from their dense rows; AC as a bitset test per suffix record; and the merge
// over the tuples, with `stemcat` appended to the stem's keys.
//
// Where upstream would raise `KeyError` or `TypeError` the port is defined
// instead; each such site names the upstream line. Upstream's output order
// depends on the Python hash seed (it iterates category `set`s); the port
// iterates the category Sets in table-line order, so its order is
// deterministic, and parity is compared in Canonical_Order.

import type { Analysis } from './analyzer.js';
import { bitsetHas, type PairOrder } from './compat-bitset.js';
import { MorphologyDb, tupleModelOf, type TupleModel } from './database.js';
import {
  GeneratorError,
  InvalidGeneratorFeature,
  InvalidGeneratorFeatureValue,
} from './errors.js';
import type { IdArray, IdIndex, KeyIndex } from './feature-schema.js';
import { stripLex } from './features.js';
import { pyRepr } from './python-compat.js';
import { TupleMerger } from './tuple-merge.js';

/**
 * A generation or reinflection request: a feature name to its requested
 * value. Keys are read in insertion order, as upstream iterates the caller's
 * dict; note that JavaScript orders integer-like keys first, which no feature
 * name of an ALMOR database is.
 */
export type GenerationFeatures = Record<string, string>;

/**
 * A request as the generator reads it internally: after the clitic default
 * fill a value may be `null` (a `*` default), and the reinflector may pass a
 * `null` analysis value through, as upstream passes `None`.
 */
type RequestFeatures = Readonly<Record<string, string | null>>;

/** The clitic features the default fill and the stem filter read. */
const CLITIC_KEYS = ['prc0', 'prc1', 'prc2', 'prc3', 'enc0', 'enc1', 'enc2'] as const;
/** The proclitic features the prefix filter reads. */
const PREFIX_CLITIC_KEYS = ['prc0', 'prc1', 'prc2', 'prc3'] as const;
/** The enclitic features the suffix filter reads. */
const SUFFIX_CLITIC_KEYS = ['enc0', 'enc1', 'enc2'] as const;

/** Python's `key in dict` for a plain record. */
function has(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Morphological generator over a model parsed with the `g` or `r` flag.
 */
export class Generator {
  private readonly db: MorphologyDb;
  private readonly model: TupleModel;
  private readonly merger: TupleMerger;
  private readonly stemCatNames: readonly string[];
  // The Stem_View of the stem being filtered, by Feature_Id: `view[f]` is
  // valid when `viewStamp[f] === viewEpoch`.
  private readonly view: (string | undefined)[];
  private readonly viewStamp: Uint32Array;
  private viewEpoch = 0;

  /**
   * @throws {GeneratorError} `DB is not an instance of MorphologyDB` when `db`
   *   is not a `MorphologyDb`, and `DB does not support generation` when it
   *   was parsed without generation. Both are upstream's messages.
   */
  constructor(db: MorphologyDb) {
    if (!(db instanceof MorphologyDb)) {
      throw new GeneratorError('DB is not an instance of MorphologyDB');
    }
    const model = tupleModelOf(db);
    if (!db.flags.generation) {
      throw new GeneratorError('DB does not support generation');
    }
    this.db = db;
    this.model = model;
    this.merger = new TupleMerger(model);
    const strings = model.strings.strings;
    this.stemCatNames = Array.from(model.header.stemCats.names, (id) => strings[id] as string);
    const f = this.merger.plan.names.length;
    this.view = new Array<string | undefined>(f).fill(undefined);
    this.viewStamp = new Uint32Array(f);
  }

  /**
   * Generate the analyses of `lemma` that agree with `feats`; the surface
   * form of each is its `diac`. `feats` must carry `pos`.
   *
   * @throws {InvalidGeneratorFeature} for a key the database does not define.
   * @throws {InvalidGeneratorFeatureValue} for a value outside a closed
   *   define, or when `pos` is absent or undefined.
   * @throws {GeneratorError} when the database has no `DEFAULTS` row for the
   *   requested `pos` (unreachable on the Database_Pin).
   */
  generate(lemma: string, feats: GenerationFeatures | RequestFeatures): Analysis[] {
    const db = this.db;

    // (a) The lemma is looked up before any validation, so an unknown lemma
    // with an invalid request returns [].
    const lemmaKey = stripLex(lemma);
    const model = this.model;
    const lemmaIndex = model.stem.lemmaIndex as KeyIndex;
    const lemmaSlot = lemmaIndex.slots.get(lemmaKey);
    if (lemmaSlot === undefined) {
      return [];
    }

    // (b) Each requested key in insertion order: undefined, then a closed
    // define lacking the value.
    for (const feat of Object.keys(feats)) {
      if (!db.defines.has(feat)) {
        throw new InvalidGeneratorFeature(feat);
      }
      const values = db.defines.get(feat) as string[] | null;
      const value = feats[feat] as string | null;
      if (values !== null && (value === null || !values.includes(value))) {
        throw new InvalidGeneratorFeatureValue(feat, value);
      }
    }

    // (c) `pos` must be present and defined. Upstream: `if 'pos' not in feats
    // or feats['pos'] not in self._db.defines['pos']`. An open `pos` define
    // (`None`) is a `TypeError` there; the port skips the membership test.
    // Reaching here with `pos` requested means (b) found it defined.
    if (!has(feats, 'pos')) {
      throw new InvalidGeneratorFeatureValue('pos', null);
    }
    const pos = feats['pos'] as string | null;
    const posValues = db.defines.get('pos') as string[] | null;
    if (posValues !== null && (pos === null || !posValues.includes(pos))) {
      throw new InvalidGeneratorFeatureValue('pos', pos);
    }

    // (d) Upstream: `default = self._db.defaults[feats['pos']]`, a `KeyError`
    // for a defined `pos` without a `DEFAULTS` row; a `GeneratorError` naming
    // it here.
    const defaultRow = db.defaults.get(pos);
    if (defaultRow === undefined) {
      throw new GeneratorError(`No DEFAULTS row for pos ${pyRepr(pos)}`);
    }
    // The subset test reads the keys given, before the fill below.
    for (const feat of Object.keys(feats)) {
      if (!has(defaultRow, feat)) {
        return [];
      }
    }
    const request: Record<string, string | null> = { ...feats };
    for (const feat of CLITIC_KEYS) {
      if (!has(request, feat) && has(defaultRow, feat)) {
        request[feat] = defaultRow[feat] as string | null;
      }
    }
    const requestKeys = Object.keys(request);

    const analyses: Analysis[] = [];
    const h = model.header;
    const stems = model.stem.stems;
    const strings = model.strings.strings;
    const merger = this.merger;
    const plan = merger.plan;
    const ids = h.schema.ids;
    const featureId = (name: string): number => ids.get(name) ?? -1;
    const view = this.view;
    const viewStamp = this.viewStamp;
    const prefixKeys = PREFIX_CLITIC_KEYS.map((name) => [name, featureId(name)] as const);
    const suffixKeys = SUFFIX_CLITIC_KEYS.map((name) => [name, featureId(name)] as const);
    const width = plan.modelFeatures;
    const prefixRows = h.prefixes.dense as Int32Array;
    const suffixRows = h.suffixes.dense as Int32Array;
    const prefixCatIndex = h.prefixCatIndex as IdIndex;
    const suffixCatIndex = h.suffixCatIndex as IdIndex;

    for (let i = lemmaIndex.start[lemmaSlot] as number; i < (lemmaIndex.start[lemmaSlot + 1] as number); i++) {
      const stem = lemmaIndex.ids[i] as number;
      const stemCat = stems.category[stem] as number;
      const stemCatName = this.stemCatNames[stemCat] as string;

      // The Stem_View: the dictionary upstream stores in `lemma_hash`, with
      // `stemcat` after the parsed keys, here read from the stem's Tuple into
      // the view scratch.
      const epoch = ++this.viewEpoch;
      const keys = h.schema.layouts[stems.layout[stem] as number] as IdArray;
      const base = stems.valueStart[stem] as number;
      for (let p = 0; p < keys.length; p++) {
        view[keys[p] as number] = strings[stems.values[base + p] as number];
        viewStamp[keys[p] as number] = epoch;
      }
      view[plan.stemcat] = stemCatName;
      viewStamp[plan.stemcat] = epoch;
      const stemHas = (f: number): boolean => f >= 0 && viewStamp[f] === epoch;

      // (e) Upstream indexes `stem_feats['vox']`, `['rat']` and `['pos']`
      // directly, a `KeyError` for a stem lacking the key (reached for `rat`
      // on the Database_Pin). An absent key counts as different, so the stem
      // is skipped.
      let skip = false;
      for (const name of ['vox', 'rat', 'pos'] as const) {
        const f = featureId(name);
        if (has(request, name) && (!stemHas(f) || view[f] !== request[name])) {
          skip = true;
          break;
        }
      }
      if (skip) {
        continue;
      }

      for (const name of CLITIC_KEYS) {
        if (!has(request, name)) {
          continue;
        }
        const f = featureId(name);
        if (stemHas(f) && view[f] !== '0' && request[name] !== view[f]) {
          skip = true;
          break;
        }
      }
      if (skip) {
        continue;
      }

      // Upstream: `self._db.stem_prefix_compat[stem_feats['stemcat']]` and
      // `self._db.stem_suffix_compat[...]`, a `KeyError` for a stem category
      // absent from AB or BC. An absent row is empty here. The rows are in
      // table-line order, so the output order is deterministic.
      const prefixCats = rowOf(h.stemPrefixOrder, stemCat);
      const suffixCats = rowOf(h.bcOrder, stemCat);

      // (f) Prefixes: each prefix category's records, in line order.
      for (const prefixCat of prefixCats) {
        for (let a = prefixCatIndex.start[prefixCat] as number; a < (prefixCatIndex.start[prefixCat + 1] as number); a++) {
          const prefix = prefixCatIndex.ids[a] as number;
          if (!cliticsAgree(prefixKeys, request, prefixRows, prefix * width, width, strings, view, stemHas)) {
            continue;
          }

          // (g) Suffixes.
          for (const suffixCat of suffixCats) {
            for (let b = suffixCatIndex.start[suffixCat] as number; b < (suffixCatIndex.start[suffixCat + 1] as number); b++) {
              const suffix = suffixCatIndex.ids[b] as number;
              // Upstream tests AC per suffix record; an absent row admits none.
              if (!bitsetHas(h.ac, prefixCat, suffixCat)) {
                continue;
              }
              if (!cliticsAgree(suffixKeys, request, suffixRows, suffix * width, width, strings, view, stemHas)) {
                continue;
              }

              // (h) Merge, then drop a result disagreeing with a requested
              // key it carries. A requested string never equals a numeric
              // log-probability, as upstream's `!=` between `str` and `float`.
              const merged = merger.merge('generator', prefix, stem, suffix, [[plan.stemcat, stemCatName]]) as Analysis;
              let ignoreAnalysis = false;
              for (const feat of requestKeys) {
                if (has(merged, feat) && merged[feat] !== request[feat]) {
                  ignoreAnalysis = true;
                  break;
                }
              }
              if (!ignoreAnalysis) {
                analyses.push(merged);
              }
            }
          }
        }
      }
    }

    return analyses;
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

/** A pair order's row for left id `left`, its right ids in line order; empty when absent. */
function rowOf(order: PairOrder, left: number): Uint32Array {
  const row = left < order.rowOf.length ? (order.rowOf[left] as number) : -1;
  return row === -1 ? EMPTY : order.ids.subarray(order.start[row], order.start[row + 1]);
}

const EMPTY = new Uint32Array(0);

/**
 * The prefix (f) and suffix (g) clitic rule: an affix record disagrees with
 * the request when, for a requested key among `keys`, either the request is
 * not `'0'`, the record lacks the key, and the stem's value (default `'0'`,
 * upstream's `stem_feats.get(feat, '0')`) differs from the request; or the
 * record has the key with a different value. The record is read from its
 * dense row (`rows[base + f]`, -1 for absent); the stem from the Stem_View.
 */
function cliticsAgree(
  keys: readonly (readonly [string, number])[],
  request: Readonly<Record<string, string | null>>,
  rows: Int32Array,
  base: number,
  width: number,
  strings: readonly string[],
  view: readonly (string | undefined)[],
  stemHas: (f: number) => boolean,
): boolean {
  for (const [name, f] of keys) {
    if (!has(request, name)) {
      continue;
    }
    const want = request[name];
    const stemValue = stemHas(f) ? view[f] : '0';
    const id = f >= 0 && f < width ? (rows[base + f] as number) : -1;
    const affixHas = id !== -1;
    if (
      (want !== '0' && !affixHas && stemValue !== want) ||
      (affixHas && want !== strings[id])
    ) {
      return false;
    }
  }
  return true;
}
