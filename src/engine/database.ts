// Ported from CAMeL Tools morphology/database.py (version 1.6.0).
// Copyright 2018-2026 New York University Abu Dhabi. MIT License.
// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.
// shanisarf's changes are Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
//
// The database model. Upstream carries one `MorphologyDB` object: the three
// affix dicts (`prefix_hash`, `suffix_hash`, `stem_hash`), the three
// compatibility tables (`prefix_stem_compat` / AB, `stem_suffix_compat` / BC,
// `prefix_suffix_compat` / AC), the header sections (`defines`, `defaults`,
// `order`, `tokenizations`, `compute_feats`, `stem_backoffs`), the two maximum
// affix sizes, the generation side (`prefix_cat_hash`, `suffix_cat_hash`,
// `lemma_hash`, `stem_prefix_compat`), and `all_feats()` and `tok_feats()`.
//
// The port keeps the same fields, but the tables live in a tuple model: each
// prefix, suffix and stem line is a category id, a Layout id and a Tuple of
// value string ids in typed arrays, in line order, categories are dense role
// ids with compatibility bitsets beside line-ordered pair lists, and every
// string is a String_Table id. The table fields read that model through
// read-only Views (`model-views.ts`) that answer as Maps would, in line order,
// with the same object sharing. The header fields are the parsed Maps, typed
// read-only. The model never changes after construction.
//
// The model is two parts with one-way references: a Header_Part (everything
// but the stems) and a Stem_Part (the stem table, its surface and lemma
// indexes, and the strings first seen in `###STEMS###` or later).
//
// `new MorphologyDb(init)` also accepts the Map-shaped init that hand-built
// models use (the adapter); the parser builds the tuple model itself through
// `ModelBuilder` and hands it over under the internal `MODEL` key. Neither
// `MODEL`, `ModelBuilder` nor `tupleModelOf` is exported from `index.ts`.

import {
  type Bitset,
  type CategoryRole,
  CategoryRoleBuilder,
  type PairOrder,
  PairTableBuilder,
} from './compat-bitset.js';
import {
  type EntryTable,
  EntryTableBuilder,
  type FeatureSchema,
  FeatureSchemaBuilder,
  type IdIndex,
  idIndex,
  type KeyIndex,
  KeyIndexBuilder,
} from './feature-schema.js';
import {
  CompatMapView,
  EntryMapView,
  EntryMemo,
  RecordMapView,
} from './model-views.js';
import { InvalidDatabaseFlagError } from './errors.js';
import { type StringTable, StringTableBuilder } from './string-table.js';

/**
 * One affix or stem line of an ALMOR database: its category and its feature
 * dictionary. The surface the entry is keyed under is the key of the map that
 * holds it, not a field, matching upstream's `(surface -> [entries])`.
 * A model's entries are frozen, and `features` holds the keys in the order
 * the line first stated them, each with its last value (a stem's `lex`
 * passed through `stripLex`).
 */
export interface Entry {
  readonly category: string;
  readonly features: Readonly<Record<string, string>>;
}

/**
 * The three database flags, as upstream's `MorphologyDBFlags`. `a` sets
 * analysis, `g` generation, `r` both. `reinflection` always equals
 * `generation`: upstream builds the record from its generation field twice, so
 * a `g`-only model reports `reinflection` true even though a Reinflector
 * cannot be built on it.
 */
export interface DatabaseFlags {
  analysis: boolean;
  generation: boolean;
  reinflection: boolean;
}

/**
 * Read a database `flags` string one character at a time, as upstream reads
 * it: `a` sets analysis, `g` generation, `r` both. Any other character is
 * refused, as upstream's `else: raise InvalidDatabaseFlagError(flag)`.
 * Upstream builds the record as `MorphologyDBFlags(self._withAnalysis,
 * self._withGeneration, self._withGeneration)`, so reinflection mirrors
 * generation.
 *
 * Shared by the parser and the Asset opener, so that opening an Asset reads
 * its flags the same way. Internal: not exported from `index.ts`.
 *
 * @throws {InvalidDatabaseFlagError} naming the first character that is not
 *   `a`, `g` or `r`.
 */
export function readDatabaseFlags(flags: string): DatabaseFlags {
  let withAnalysis = false;
  let withGeneration = false;
  for (const flag of flags) {
    if (flag === 'a') {
      withAnalysis = true;
    } else if (flag === 'g') {
      withGeneration = true;
    } else if (flag === 'r') {
      withAnalysis = true;
      withGeneration = true;
    } else {
      throw new InvalidDatabaseFlagError(flag);
    }
  }
  return {
    analysis: withAnalysis,
    generation: withGeneration,
    reinflection: withGeneration,
  };
}

/** The header sections, as parsed. */
export interface HeaderSections {
  readonly flags: Readonly<DatabaseFlags>;
  readonly defines: ReadonlyMap<string, readonly string[] | null>;
  readonly defaults: ReadonlyMap<string | null, Readonly<Record<string, string | null>>>;
  readonly order: readonly string[] | null;
  readonly tokenizations: ReadonlySet<string>;
  readonly computeFeats: ReadonlySet<string>;
  readonly stemBackoffs: ReadonlyMap<string, readonly string[]>;
}

/**
 * The Header_Part: everything but the stems. It refers to no Stem_Part
 * string id and no stem entry id.
 */
export interface HeaderPart extends HeaderSections {
  readonly schema: FeatureSchema;
  readonly prefixCats: CategoryRole;
  readonly stemCats: CategoryRole;
  readonly suffixCats: CategoryRole;
  /** AB (P × S), BC (S × X), AC (P × X). */
  readonly ab: Bitset;
  readonly bc: Bitset;
  readonly ac: Bitset;
  /** AB (analysis only), BC and AC pairs in line order; AB transposed (generation only). */
  readonly abOrder: PairOrder;
  readonly bcOrder: PairOrder;
  readonly acOrder: PairOrder;
  readonly stemPrefixOrder: PairOrder;
  readonly prefixes: EntryTable;
  readonly suffixes: EntryTable;
  /** Surface → entries; analysis only. */
  readonly prefixIndex: KeyIndex | null;
  readonly suffixIndex: KeyIndex | null;
  /** Category id → entries; generation only. */
  readonly prefixCatIndex: IdIndex | null;
  readonly suffixCatIndex: IdIndex | null;
  readonly maxPrefixSize: number;
  readonly maxSuffixSize: number;
}

/** The Stem_Part: the stem table and its indexes. */
export interface StemPart {
  readonly stems: EntryTable;
  /** Surface → entries; analysis only. */
  readonly stemIndex: KeyIndex | null;
  /** Stripped `lex` → entries; generation only. */
  readonly lemmaIndex: KeyIndex | null;
}

/** A model's tuple form (internal; never exported from `index.ts`). */
export interface TupleModel {
  readonly header: HeaderPart;
  readonly stem: StemPart;
  readonly strings: StringTable;
}

/** The facts-table, generation and Layout counts of a model (`counts()`). */
export interface ModelCounts {
  readonly prefixSurfaces: number;
  readonly prefixEntries: number;
  readonly maxPrefixSize: number;
  readonly suffixSurfaces: number;
  readonly suffixEntries: number;
  readonly maxSuffixSize: number;
  readonly stemSurfaces: number;
  readonly stemEntries: number;
  readonly tablePairsAB: number;
  readonly tablePairsBC: number;
  readonly tablePairsAC: number;
  readonly prefixCategories: number;
  readonly prefixRecords: number;
  readonly suffixCategories: number;
  readonly suffixRecords: number;
  readonly lemmas: number;
  readonly lemmaStems: number;
  readonly stemPrefixCategories: number;
  readonly stemPrefixPairs: number;
  readonly featureNames: number;
  readonly prefixLayouts: number;
  readonly suffixLayouts: number;
  readonly stemLayouts: number;
}

/**
 * The Map-shaped init a hand-built model passes (the adapter): the header
 * sections and the analysis-side tables. Entry "line order" is the Maps'
 * iteration order. The generation side, when `flags.generation` is set, is
 * derived from the entries (by category, and by each stem's `lex`) and from
 * AB.
 */
export interface MorphologyDbInit {
  flags: DatabaseFlags;
  defines: ReadonlyMap<string, readonly string[] | null>;
  defaults: ReadonlyMap<string | null, Readonly<Record<string, string | null>>>;
  order: readonly string[] | null;
  tokenizations: ReadonlySet<string>;
  computeFeats: ReadonlySet<string>;
  stemBackoffs: ReadonlyMap<string, readonly string[]>;
  prefixes: ReadonlyMap<string, readonly Entry[]>;
  suffixes: ReadonlyMap<string, readonly Entry[]>;
  stems: ReadonlyMap<string, readonly Entry[]>;
  prefixStemCompat: ReadonlyMap<string, ReadonlySet<string>>;
  stemSuffixCompat: ReadonlyMap<string, ReadonlySet<string>>;
  prefixSuffixCompat: ReadonlyMap<string, ReadonlySet<string>>;
  maxPrefixSize: number;
  maxSuffixSize: number;
}

/**
 * Where a model loaded from an Asset came from: its Manifest's descriptive
 * fields and the Asset_Digest. The attribution travels with the database into
 * every program that loads it. A parsed or hand-built model has none.
 */
export interface Provenance {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly license: Readonly<{ id: string; url: string }>;
  readonly credits: string;
  readonly disclaimer: string;
  readonly citation: string;
  readonly source: string;
  readonly sourceSha256: string;
  readonly sourceBytes: number;
  readonly formatVersion: number;
  /** The SHA-256 of the Manifest's bytes, lowercase hex. */
  readonly assetDigest: string;
}

/** The internal key under which a built tuple model is handed to the constructor. */
export const MODEL: unique symbol = Symbol('shanisarf.tupleModel');

/** The internal key under which a loaded model's {@link Provenance} is handed over. */
export const PROVENANCE: unique symbol = Symbol('shanisarf.provenance');

/** The internal init: a tuple model already built (by the parser or the Model_Codec). */
export interface TupleModelInit {
  readonly [MODEL]: TupleModel;
  readonly [PROVENANCE]?: Provenance | null;
}

const MODELS = new WeakMap<MorphologyDb, TupleModel>();

/**
 * The parsed ALMOR database.
 *
 * - `defines`: a define's name to its value list, or `null` for an open class
 *   (`*open*`). Values are in first-seen order; only membership is ever read.
 * - `defaults`: a `pos` value (or `null` for the `pos:*` row) to that row's
 *   `feature -> value` record, where a `*` value is `null`.
 * - `order`: the `ORDER` feature list, or `null` when the section was absent.
 * - `tokenizations`, `computeFeats`: the tokenization feature names, and the
 *   set the parser fills from `ORDER` at the `###TOKENIZATIONS###` marker.
 * - `stemBackoffs`: a backoff action (`ALL`, `PROP`) to its category list.
 * - `prefixes`, `suffixes`, `stems` (Views, analysis only): a surface to its
 *   entries. `lemmaHash` (View, generation only): a stripped `lex` to its stem
 *   entries, the same objects `stems` holds.
 * - `prefixCatHash`, `suffixCatHash` (Views, generation only): a category to
 *   the feature records of its lines, the same objects the entries hold.
 * - `prefixStemCompat` (AB, analysis only), `stemSuffixCompat` (BC),
 *   `prefixSuffixCompat` (AC), `stemPrefixCompat` (AB transposed, generation
 *   only) (Views): a category to the set of its compatible categories.
 * - `maxPrefixSize`, `maxSuffixSize`: the greatest code-point length of any
 *   prefix / suffix surface (0 without analysis), bounding segmentation.
 *
 * Everything is read-only and fixed at construction. The Views materialize
 * entries as they are read and keep them, so reading every stem through them
 * costs the memory the tuple model saves.
 */
export class MorphologyDb {
  readonly flags: Readonly<DatabaseFlags>;
  readonly defines: ReadonlyMap<string, readonly string[] | null>;
  readonly defaults: ReadonlyMap<string | null, Readonly<Record<string, string | null>>>;
  readonly order: readonly string[] | null;
  readonly tokenizations: ReadonlySet<string>;
  readonly computeFeats: ReadonlySet<string>;
  readonly stemBackoffs: ReadonlyMap<string, readonly string[]>;
  readonly prefixes: ReadonlyMap<string, readonly Entry[]>;
  readonly suffixes: ReadonlyMap<string, readonly Entry[]>;
  readonly stems: ReadonlyMap<string, readonly Entry[]>;
  readonly prefixStemCompat: ReadonlyMap<string, ReadonlySet<string>>;
  readonly stemSuffixCompat: ReadonlyMap<string, ReadonlySet<string>>;
  readonly prefixSuffixCompat: ReadonlyMap<string, ReadonlySet<string>>;
  readonly maxPrefixSize: number;
  readonly maxSuffixSize: number;
  readonly prefixCatHash: ReadonlyMap<string, readonly Readonly<Record<string, string>>[]>;
  readonly suffixCatHash: ReadonlyMap<string, readonly Readonly<Record<string, string>>[]>;
  readonly lemmaHash: ReadonlyMap<string, readonly Entry[]>;
  readonly stemPrefixCompat: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * The Asset's Provenance, frozen, for a model opened from an Asset; `null`
   * for a parsed or hand-built model. It is on the database, never on a
   * result.
   */
  readonly provenance: Readonly<Provenance> | null;

  constructor(init: MorphologyDbInit | TupleModelInit) {
    const model = MODEL in init ? init[MODEL] : modelFromInit(init);
    MODELS.set(this, model);
    const provenance = MODEL in init ? (init[PROVENANCE] ?? null) : null;
    this.provenance = provenance === null ? null : freezeProvenance(provenance);
    const h = model.header;
    const s = model.stem;

    this.flags = h.flags;
    this.defines = h.defines;
    this.defaults = h.defaults;
    this.order = h.order;
    this.tokenizations = h.tokenizations;
    this.computeFeats = h.computeFeats;
    this.stemBackoffs = h.stemBackoffs;
    this.maxPrefixSize = h.maxPrefixSize;
    this.maxSuffixSize = h.maxSuffixSize;

    const memo = new EntryMemo(model);
    this.prefixes = new EntryMapView(memo, 'prefixes', h.prefixIndex);
    this.suffixes = new EntryMapView(memo, 'suffixes', h.suffixIndex);
    this.stems = new EntryMapView(memo, 'stems', s.stemIndex);
    this.lemmaHash = new EntryMapView(memo, 'stems', s.lemmaIndex);
    this.prefixCatHash = new RecordMapView(model, memo, 'prefixes', h.prefixCatIndex);
    this.suffixCatHash = new RecordMapView(model, memo, 'suffixes', h.suffixCatIndex);
    this.prefixStemCompat = new CompatMapView(model, h.abOrder, h.prefixCats, h.stemCats);
    this.stemSuffixCompat = new CompatMapView(model, h.bcOrder, h.stemCats, h.suffixCats);
    this.prefixSuffixCompat = new CompatMapView(model, h.acOrder, h.prefixCats, h.suffixCats);
    this.stemPrefixCompat = new CompatMapView(model, h.stemPrefixOrder, h.stemCats, h.prefixCats);
  }

  /**
   * The facts-table counts, the generation counts and the Layout counts, read
   * from the index arrays without materializing anything. A side whose flag is
   * off counts 0, as its Views are empty.
   */
  counts(): Readonly<ModelCounts> {
    const model = tupleModelOf(this);
    const h = model.header;
    const s = model.stem;
    const analysis = h.flags.analysis;
    const generation = h.flags.generation;
    return Object.freeze({
      prefixSurfaces: h.prefixIndex?.slots.size ?? 0,
      prefixEntries: analysis ? h.prefixes.count : 0,
      maxPrefixSize: h.maxPrefixSize,
      suffixSurfaces: h.suffixIndex?.slots.size ?? 0,
      suffixEntries: analysis ? h.suffixes.count : 0,
      maxSuffixSize: h.maxSuffixSize,
      stemSurfaces: s.stemIndex?.slots.size ?? 0,
      stemEntries: analysis ? s.stems.count : 0,
      tablePairsAB: h.abOrder.ids.length,
      tablePairsBC: h.bcOrder.ids.length,
      tablePairsAC: h.acOrder.ids.length,
      prefixCategories: filledSlots(h.prefixCatIndex),
      prefixRecords: generation ? h.prefixes.count : 0,
      suffixCategories: filledSlots(h.suffixCatIndex),
      suffixRecords: generation ? h.suffixes.count : 0,
      lemmas: s.lemmaIndex?.slots.size ?? 0,
      lemmaStems: s.lemmaIndex?.ids.length ?? 0,
      stemPrefixCategories: h.stemPrefixOrder.rows.length,
      stemPrefixPairs: h.stemPrefixOrder.ids.length,
      featureNames: h.schema.names.length,
      prefixLayouts: new Set(h.prefixes.layout).size,
      suffixLayouts: new Set(h.suffixes.layout).size,
      stemLayouts: new Set(s.stems.layout).size,
    });
  }

  /**
   * The set of feature names the database defines (the keys of `defines`),
   * matching upstream's `all_feats()`. A fresh set each call.
   */
  allFeats(): Set<string> {
    return new Set(this.defines.keys());
  }

  /**
   * The set of tokenization feature names, matching upstream's
   * `tok_feats()`. A fresh set each call.
   */
  tokFeats(): Set<string> {
    return new Set(this.tokenizations);
  }
}

/** A frozen copy of `p`, its license record frozen too. */
function freezeProvenance(p: Provenance): Readonly<Provenance> {
  return Object.freeze({
    id: p.id,
    name: p.name,
    version: p.version,
    license: Object.freeze({ id: p.license.id, url: p.license.url }),
    credits: p.credits,
    disclaimer: p.disclaimer,
    citation: p.citation,
    source: p.source,
    sourceSha256: p.sourceSha256,
    sourceBytes: p.sourceBytes,
    formatVersion: p.formatVersion,
    assetDigest: p.assetDigest,
  });
}

/**
 * The tuple model behind `db` (internal; never exported from `index.ts`).
 */
export function tupleModelOf(db: MorphologyDb): TupleModel {
  const model = MODELS.get(db);
  if (model === undefined) {
    throw new TypeError('not a MorphologyDb');
  }
  return model;
}

/** The Header_Part with its strings: the String_Table ids below `headerCount`. */
export interface HeaderShard {
  readonly header: HeaderPart;
  readonly strings: readonly string[];
}

/** The Stem_Part with its strings: the String_Table ids from `headerCount` up, in order. */
export interface StemShard {
  readonly stem: StemPart;
  readonly strings: readonly string[];
}

/**
 * The model's two parts (internal): the Header_Part with the strings below
 * `headerCount`, and the Stem_Part with the rest. The parts share the model's
 * arrays; nothing is copied.
 */
export function splitModel(db: MorphologyDb): [HeaderShard, StemShard] {
  const model = tupleModelOf(db);
  const { strings, headerCount } = model.strings;
  return [
    { header: model.header, strings: strings.slice(0, headerCount) },
    { stem: model.stem, strings: strings.slice(headerCount) },
  ];
}

/** A model from its two parts, as {@link splitModel} gives them (internal). */
export function joinModel(header: HeaderShard, stem: StemShard): MorphologyDb {
  return new MorphologyDb({
    [MODEL]: {
      header: header.header,
      stem: stem.stem,
      strings: { strings: [...header.strings, ...stem.strings], headerCount: header.strings.length },
    },
  });
}

/**
 * Check the one-way reference: every string id the Header_Part holds (affix
 * values and dense rows, every role's names) is below `headerCount`, and every
 * entry id its indexes hold is an affix entry. A violation is a builder
 * defect, not bad input.
 */
function assertHeaderSeparate(header: HeaderPart, headerCount: number): void {
  const fail = (what: string): never => {
    throw new Error(`tuple model: the Header_Part refers to the Stem_Part (${what})`);
  };
  for (const [name, table] of [['prefix', header.prefixes], ['suffix', header.suffixes]] as const) {
    for (const id of table.values) {
      if (id >= headerCount) fail(`a ${name} value`);
    }
    for (const id of table.dense ?? []) {
      if (id >= headerCount) fail(`a ${name} dense row`);
    }
  }
  for (const [name, role] of [
    ['prefix', header.prefixCats],
    ['stem', header.stemCats],
    ['suffix', header.suffixCats],
  ] as const) {
    for (const id of role.names) {
      if (id >= headerCount) fail(`a ${name} category name`);
    }
  }
  for (const [name, index, count] of [
    ['prefix surface', header.prefixIndex, header.prefixes.count],
    ['suffix surface', header.suffixIndex, header.suffixes.count],
    ['prefix category', header.prefixCatIndex, header.prefixes.count],
    ['suffix category', header.suffixCatIndex, header.suffixes.count],
  ] as const) {
    for (const id of index?.ids ?? []) {
      if (id >= count) fail(`a ${name} index entry`);
    }
  }
}

function filledSlots(index: IdIndex | null): number {
  let filled = 0;
  if (index !== null) {
    for (let slot = 0; slot + 1 < index.start.length; slot++) {
      if ((index.start[slot + 1] as number) > (index.start[slot] as number)) {
        filled++;
      }
    }
  }
  return filled;
}

/**
 * Builds a {@link TupleModel}, for the parser and the adapter alike. The
 * caller feeds the sections in database order (prefix, suffix and stem lines,
 * then tables AB, BC and AC), so role ids and Feature_Ids come out in
 * first-seen order; it calls `strings.endHeader()` at the `###STEMS###`
 * boundary.
 */
export class ModelBuilder {
  readonly flags: Readonly<DatabaseFlags>;
  readonly strings = new StringTableBuilder();
  readonly schema = new FeatureSchemaBuilder();
  readonly prefixes: EntryTableBuilder;
  readonly suffixes: EntryTableBuilder;
  readonly stems: EntryTableBuilder;
  readonly prefixSurfaces = new KeyIndexBuilder();
  readonly suffixSurfaces = new KeyIndexBuilder();
  readonly stemSurfaces = new KeyIndexBuilder();
  readonly lemmas = new KeyIndexBuilder();
  readonly ab = new PairTableBuilder();
  readonly bc = new PairTableBuilder();
  readonly ac = new PairTableBuilder();
  readonly abTransposed = new PairTableBuilder();
  private readonly prefixCats = new CategoryRoleBuilder();
  private readonly stemCats = new CategoryRoleBuilder();
  private readonly suffixCats = new CategoryRoleBuilder();
  private readonly headerId = (name: string): number => this.strings.internHeader(name);

  constructor(flags: Readonly<DatabaseFlags>) {
    this.flags = Object.freeze({ ...flags });
    this.prefixes = new EntryTableBuilder(this.schema);
    this.suffixes = new EntryTableBuilder(this.schema);
    this.stems = new EntryTableBuilder(this.schema);
  }

  /** The Feature_Id of `name`, its copy interned as a header string on first sight. */
  featureId(name: string): number {
    const known = this.schema.ids.get(name);
    return known === undefined ? this.schema.featureId(this.strings.copyHeader(name)) : known;
  }

  /** Role ids; each name is interned as a header string. */
  prefixCategory(name: string): number {
    return this.prefixCats.roleId(name, this.headerId);
  }

  stemCategory(name: string): number {
    return this.stemCats.roleId(name, this.headerId);
  }

  suffixCategory(name: string): number {
    return this.suffixCats.roleId(name, this.headerId);
  }

  /** Seal the strings and freeze every table into a {@link TupleModel}. */
  finish(header: HeaderSections, maxPrefixSize: number, maxSuffixSize: number): TupleModel {
    const sealed = this.strings.seal();
    const remap = sealed.remap;
    const schema = this.schema.finish();
    const prefixCats = this.prefixCats.finish(remap);
    const stemCats = this.stemCats.finish(remap);
    const suffixCats = this.suffixCats.finish(remap);
    const p = prefixCats.names.length;
    const st = stemCats.names.length;
    const x = suffixCats.names.length;
    const prefixes = this.prefixes.finish(schema, remap, p, true);
    const suffixes = this.suffixes.finish(schema, remap, x, true);
    const stems = this.stems.finish(schema, remap, st, false);
    const ab = this.ab.finish(p, st);
    const bc = this.bc.finish(st, x);
    const ac = this.ac.finish(p, x);
    const abT = this.abTransposed.finish(st, p);
    const analysis = this.flags.analysis;
    const generation = this.flags.generation;
    const model: TupleModel = {
      header: {
        ...header,
        flags: this.flags,
        schema,
        prefixCats,
        stemCats,
        suffixCats,
        ab: ab.bitset,
        bc: bc.bitset,
        ac: ac.bitset,
        abOrder: ab.order,
        bcOrder: bc.order,
        acOrder: ac.order,
        stemPrefixOrder: abT.order,
        prefixes,
        suffixes,
        prefixIndex: analysis ? this.prefixSurfaces.finish() : null,
        suffixIndex: analysis ? this.suffixSurfaces.finish() : null,
        prefixCatIndex: generation ? idIndex(prefixes.category, p) : null,
        suffixCatIndex: generation ? idIndex(suffixes.category, x) : null,
        maxPrefixSize,
        maxSuffixSize,
      },
      stem: {
        stems,
        stemIndex: analysis ? this.stemSurfaces.finish() : null,
        lemmaIndex: generation ? this.lemmas.finish() : null,
      },
      strings: { strings: sealed.strings, headerCount: sealed.headerCount },
    };
    assertHeaderSeparate(model.header, sealed.headerCount);
    return model;
  }
}

/**
 * The adapter: a tuple model from a hand-built, Map-shaped init. Line order is
 * the Maps' iteration order. The header sections are copied, so the caller's
 * Maps cannot change the model later. Under generation, a stem without `lex`
 * is left out of `lemmaHash`.
 */
function modelFromInit(init: MorphologyDbInit): TupleModel {
  const b = new ModelBuilder(init.flags);
  const { analysis, generation } = b.flags;

  for (const name of init.defines.keys()) {
    b.featureId(name);
  }

  const addEntries = (
    hash: ReadonlyMap<string, readonly Entry[]>,
    table: EntryTableBuilder,
    category: (name: string) => number,
    surfaces: KeyIndexBuilder,
    lemmas: KeyIndexBuilder | null,
  ): void => {
    for (const [surface, entries] of hash) {
      for (const entry of entries) {
        table.begin();
        for (const [key, value] of Object.entries(entry.features)) {
          table.token(b.featureId(key), b.strings.intern(value));
        }
        const lex = entry.features['lex'];
        const id = table.end(category(entry.category));
        if (analysis) {
          surfaces.add(b.strings.copy(surface), id);
        }
        if (lemmas !== null && lex !== undefined) {
          lemmas.add(b.strings.copy(lex), id);
        }
      }
    }
  };
  addEntries(init.prefixes, b.prefixes, (c) => b.prefixCategory(c), b.prefixSurfaces, null);
  addEntries(init.suffixes, b.suffixes, (c) => b.suffixCategory(c), b.suffixSurfaces, null);
  b.strings.endHeader();
  addEntries(init.stems, b.stems, (c) => b.stemCategory(c), b.stemSurfaces, generation ? b.lemmas : null);

  for (const [left, rights] of init.prefixStemCompat) {
    for (const right of rights) {
      const l = b.prefixCategory(left);
      const r = b.stemCategory(right);
      if (analysis) {
        b.ab.add(l, r);
      }
      if (generation) {
        b.abTransposed.add(r, l);
      }
    }
  }
  for (const [left, rights] of init.stemSuffixCompat) {
    for (const right of rights) {
      b.bc.add(b.stemCategory(left), b.suffixCategory(right));
    }
  }
  for (const [left, rights] of init.prefixSuffixCompat) {
    for (const right of rights) {
      b.ac.add(b.prefixCategory(left), b.suffixCategory(right));
    }
  }

  return b.finish(
    {
      flags: b.flags,
      defines: new Map([...init.defines].map(([k, v]) => [k, v === null ? null : Object.freeze([...v])])),
      defaults: new Map([...init.defaults].map(([k, row]) => [k, Object.freeze({ ...row })])),
      order: init.order === null ? null : Object.freeze([...init.order]),
      tokenizations: new Set(init.tokenizations),
      computeFeats: new Set(init.computeFeats),
      stemBackoffs: new Map([...init.stemBackoffs].map(([k, v]) => [k, Object.freeze([...v])])),
    },
    init.maxPrefixSize,
    init.maxSuffixSize,
  );
}
