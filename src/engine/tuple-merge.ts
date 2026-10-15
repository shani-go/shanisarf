// Ported from CAMeL Tools camel_tools/morphology/utils.py (version 1.6.0).
// Copyright 2018-2026 New York University Abu Dhabi. MIT License.
// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.
// shanisarf's changes are Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
//
// The merge over Tuples: it mirrors upstream's `utils.merge_features`, steps
// (a) through (l) in order, read from the tuple model instead of three
// dictionaries.
//
// - The Merge_Plan, once per model: each constant-set step's Feature_Ids in
//   the constant sets' iteration order, filtered by `defines` (JOIN, CONCAT,
//   CONCAT_NONE, TOK_SCHEMES_1, TOK_SCHEMES_2, LOGPROB), whether `caphi`,
//   `form_gen` and `form_num` are defined and `pattern` computed, and the
//   Feature_Ids of the names the steps read or write. A name the steps write
//   that no line states and no define names (only `lex`, on the backoff path
//   of a hand-built model) gets a Feature_Id past the model's list.
// - The scratch: `val` and `stamp`, indexed by Feature_Id; a key is present in
//   the current result when `stamp[f] === epoch`, and each merge starts a new
//   epoch, so nothing is cleared. That keeps a key that is absent apart from a
//   key present with the value `undefined` (step (f) when a stem has no
//   `diac`, step (j) when `form_gen` is defined but absent). The stem's own
//   values, which steps (c), (e), (f) and (k) read, sit beside them in
//   `stemVal` / `stemStamp`.
// - Three stem sources: a stem entry id (lexical), the same with overrides
//   (the backoff path's per-pair copy: `bw`, `diac`, `lex`, `caphi`, a key the
//   stem lacks appended in that order), and the same with `stemcat` appended
//   (the Generator's Stem_View). An override replaces a Layout key's value in
//   place and appends any other, which is where `copy[k] = …` and
//   `{ ...features, stemcat }` put it.
// - The Result_Order: JavaScript keeps a key at its first assignment, and
//   steps (c)–(l) assign their keys whatever the values (step (j) only
//   reassigns keys already present), so the order is a function of the stem's
//   keys and the plan. It is memoized per (Layout, path) and materialized by
//   assigning `o[name] = val[f]` into `{}` in that order: one object shape per
//   order. The caller then applies its path's tail (lexical: `stem`,
//   `stemcat`, `source` on `spvar`; backoff: `stem`, `stemcat`, `source`,
//   `pattern`, `gloss`; Generator: none).
//
// Affix values come from the dense rows (`-1` is absent); strings are joined
// and rewritten with `features.ts`'s functions; step (l) is `Number(v ??
// -99.0)` over the value the overlay leaves, at merge time.

import type { TupleModel } from './database.js';
import type { IdArray } from './feature-schema.js';
import {
  CONCAT_FEATS,
  CONCAT_FEATS_NONE,
  JOIN_FEATS,
  LOGPROB_FEATS,
  normalizeTanwyn,
  rewriteCaphi,
  rewriteDiac,
  rewritePattern,
  rewriteTok1,
  rewriteTok2,
  TOK_SCHEMES_1,
  TOK_SCHEMES_2,
} from './features.js';

/** A merged analysis before the caller's tail: strings, numbers (step (l)), or `undefined`. */
export type MergedRecord = Record<string, string | number | undefined>;

/** A model's Merge_Plan. */
export interface MergePlan {
  /** Feature_Id → name, the model's list plus any written name it lacks. */
  readonly names: readonly string[];
  /** The model's own Feature_Name count: the dense rows' width. */
  readonly modelFeatures: number;
  readonly join: Int32Array;
  readonly concat: Int32Array;
  readonly concatNone: Int32Array;
  readonly tok1: Int32Array;
  readonly tok2: Int32Array;
  readonly logprob: Int32Array;
  readonly hasCaphi: boolean;
  readonly hasFormGen: boolean;
  readonly hasFormNum: boolean;
  readonly computePattern: boolean;
  /** Feature_Ids of the fixed names, -1 for a name the model never has. */
  readonly diac: number;
  readonly gloss: number;
  readonly stem: number;
  readonly stemgloss: number;
  readonly gen: number;
  readonly num: number;
  readonly formGen: number;
  readonly formNum: number;
  readonly pattern: number;
  readonly caphi: number;
  readonly bw: number;
  readonly lex: number;
  readonly stemcat: number;
}

/** The path a merge serves; each has its own memoized Result_Orders. */
export type MergePath = 'lexical' | 'backoff' | 'generator';

const PLANS = new WeakMap<TupleModel, MergePlan>();

/** The model's Merge_Plan, computed on first use and kept for the model's life. */
export function mergePlan(model: TupleModel): MergePlan {
  let plan = PLANS.get(model);
  if (plan === undefined) {
    plan = buildPlan(model);
    PLANS.set(model, plan);
  }
  return plan;
}

function buildPlan(model: TupleModel): MergePlan {
  const h = model.header;
  const names = [...h.schema.names];
  const ids = new Map(h.schema.ids);
  const id = (name: string): number => ids.get(name) ?? -1;
  // The steps write `lex` on the backoff path; every other name they write is
  // in the list (the merge-step names, or the stem's own keys).
  if (!ids.has('lex')) {
    ids.set('lex', names.length);
    names.push('lex');
  }
  const defined = (set: ReadonlySet<string>): Int32Array =>
    Int32Array.from([...set].filter((name) => h.defines.has(name)), (name) => id(name));
  return {
    names,
    modelFeatures: h.schema.names.length,
    join: defined(JOIN_FEATS),
    concat: defined(CONCAT_FEATS),
    concatNone: defined(CONCAT_FEATS_NONE),
    tok1: defined(TOK_SCHEMES_1),
    tok2: defined(TOK_SCHEMES_2),
    logprob: defined(LOGPROB_FEATS),
    hasCaphi: h.defines.has('caphi'),
    hasFormGen: h.defines.has('form_gen'),
    hasFormNum: h.defines.has('form_num'),
    computePattern: h.computeFeats.has('pattern'),
    diac: id('diac'),
    gloss: id('gloss'),
    stem: id('stem'),
    stemgloss: id('stemgloss'),
    gen: id('gen'),
    num: id('num'),
    formGen: id('form_gen'),
    formNum: id('form_num'),
    pattern: id('pattern'),
    caphi: id('caphi'),
    bw: id('bw'),
    lex: id('lex'),
    stemcat: id('stemcat'),
  };
}

/**
 * The merge over one model. It holds the scratch, so one instance serves one
 * caller at a time (an Analyzer, a Generator); the plan is shared.
 */
export class TupleMerger {
  readonly plan: MergePlan;
  private readonly model: TupleModel;
  private readonly strings: readonly string[];
  private readonly val: (string | number | undefined)[];
  private readonly stamp: Uint32Array;
  private readonly stemVal: (string | undefined)[];
  private readonly stemStamp: Uint32Array;
  private epoch = 0;
  // The stem's keys in order for the current merge: its Layout, then any
  // appended override.
  private readonly stemKeys: number[] = [];
  private readonly orders: Record<MergePath, (Int32Array | undefined)[]> = {
    lexical: [],
    backoff: [],
    generator: [],
  };

  constructor(model: TupleModel) {
    this.model = model;
    this.plan = mergePlan(model);
    this.strings = model.strings.strings;
    const f = this.plan.names.length;
    this.val = new Array<string | number | undefined>(f).fill(undefined);
    this.stamp = new Uint32Array(f);
    this.stemVal = new Array<string | undefined>(f).fill(undefined);
    this.stemStamp = new Uint32Array(f);
  }

  /**
   * Merge prefix entry `prefix`, stem entry `stem` and suffix entry `suffix`
   * (upstream `merge_features` steps (a)–(l)), and materialize the
   * result. `overrides` are `[Feature_Id, value]` pairs applied to the stem's
   * features first, in order: the backoff path's copy, the Generator's
   * `stemcat`. `path` selects the memoized Result_Orders, which assume the
   * same override keys on every call of a path.
   */
  merge(
    path: MergePath,
    prefix: number,
    stem: number,
    suffix: number,
    overrides?: readonly (readonly [number, string])[],
  ): MergedRecord {
    const plan = this.plan;
    const strings = this.strings;
    const val = this.val;
    const stamp = this.stamp;
    const stemVal = this.stemVal;
    const stemStamp = this.stemStamp;
    const h = this.model.header;
    const stems = this.model.stem.stems;
    const width = plan.modelFeatures;
    const prefixRow = h.prefixes.dense as Int32Array;
    const suffixRow = h.suffixes.dense as Int32Array;
    const prefixBase = prefix * width;
    const suffixBase = suffix * width;
    const epoch = ++this.epoch;

    const affix = (row: Int32Array, base: number, f: number): string | undefined => {
      if (f < 0 || f >= width) {
        return undefined;
      }
      const id = row[base + f] as number;
      return id === -1 ? undefined : (strings[id] as string);
    };
    const stemValue = (f: number): string | undefined =>
      f >= 0 && stemStamp[f] === epoch ? stemVal[f] : undefined;
    const result = (f: number): string | number | undefined =>
      f >= 0 && stamp[f] === epoch ? val[f] : undefined;
    const set = (f: number, v: string | number | undefined): void => {
      val[f] = v;
      stamp[f] = epoch;
    };

    // (a) A copy of the stem: its Layout's keys and values, then the
    // overrides, each replacing a key in place or appending it.
    const layoutId = stems.layout[stem] as number;
    const keys = h.schema.layouts[layoutId] as IdArray;
    const base = stems.valueStart[stem] as number;
    const stemKeys = this.stemKeys;
    stemKeys.length = 0;
    for (let i = 0; i < keys.length; i++) {
      const f = keys[i] as number;
      const v = strings[stems.values[base + i] as number] as string;
      stemVal[f] = v;
      stemStamp[f] = epoch;
      set(f, v);
      stemKeys.push(f);
    }
    if (overrides !== undefined) {
      for (const [f, v] of overrides) {
        if (stemStamp[f] !== epoch) {
          stemKeys.push(f);
        }
        stemVal[f] = v;
        stemStamp[f] = epoch;
        set(f, v);
      }
    }

    // (b) Overlay the suffix, then the prefix, on the stem's keys, each value
    // kept when it is neither '-' nor ''.
    for (const f of stemKeys) {
      const s = affix(suffixRow, suffixBase, f) ?? '';
      if (s !== '-' && s !== '') {
        set(f, s);
      }
      const p = affix(prefixRow, prefixBase, f) ?? '';
      if (p !== '-' && p !== '') {
        set(f, p);
      }
    }

    // (c) JOIN_FEATS: '+'-join the present, non-empty values.
    for (const f of plan.join) {
      const parts: string[] = [];
      for (const v of [affix(prefixRow, prefixBase, f), stemValue(f), affix(suffixRow, suffixBase, f)]) {
        if (v !== undefined && v !== '') {
          parts.push(v);
        }
      }
      set(f, parts.join('+'));
    }

    // (d) CONCAT_FEATS: '+'-join the non-empty values (absent reads as '').
    for (const f of plan.concat) {
      const parts: string[] = [];
      for (const v of [affix(prefixRow, prefixBase, f), stemValue(f), affix(suffixRow, suffixBase, f)]) {
        if (v !== undefined && v.length > 0) {
          parts.push(v);
        }
      }
      set(f, parts.join('+'));
    }

    // (e) CONCAT_FEATS_NONE: concatenated, the stem defaulting to its diac.
    for (const f of plan.concatNone) {
      set(
        f,
        (affix(prefixRow, prefixBase, f) ?? '') +
          (stemValue(f) ?? stemValue(plan.diac) ?? '') +
          (affix(suffixRow, suffixBase, f) ?? ''),
      );
    }

    // (f) The stem surface (the stem's diac, possibly absent) and stem gloss.
    set(plan.stem, stemValue(plan.diac));
    set(plan.stemgloss, stemValue(plan.gloss) ?? '');

    // (g) The diacritic rewrite, then tanwin normalization.
    set(plan.diac, normalizeTanwyn(rewriteDiac((result(plan.diac) as string | undefined) ?? ''), 'AF'));

    // (h) The tokenization-scheme rewrites.
    for (const f of plan.tok1) {
      set(f, rewriteTok1((result(f) as string | undefined) ?? ''));
    }
    for (const f of plan.tok2) {
      set(f, rewriteTok2((result(f) as string | undefined) ?? ''));
    }

    // (i) The CAPHI rewrite.
    if (plan.hasCaphi) {
      set(plan.caphi, rewriteCaphi((result(plan.caphi) as string | undefined) ?? ''));
    }

    // (j) The form_gen / form_num fix: `gen` is present when it equals '-'.
    if (plan.hasFormGen && result(plan.gen) === '-') {
      set(plan.gen, result(plan.formGen));
    }
    if (plan.hasFormNum && result(plan.num) === '-') {
      set(plan.num, result(plan.formNum));
    }

    // (k) The computed pattern.
    if (plan.computePattern) {
      set(
        plan.pattern,
        rewritePattern(
          (affix(prefixRow, prefixBase, plan.diac) ?? '') +
            (stemValue(plan.pattern) ?? stemValue(plan.diac) ?? '') +
            (affix(suffixRow, suffixBase, plan.diac) ?? ''),
        ),
      );
    }

    // (l) LOGPROB_FEATS: a number, -99 by default.
    for (const f of plan.logprob) {
      set(f, Number(result(f) ?? -99.0));
    }

    // Materialize in Result_Order.
    const order = this.resultOrder(path, layoutId, keys);
    const names = plan.names;
    const out: MergedRecord = {};
    for (const f of order) {
      out[names[f] as string] = val[f];
    }
    return out;
  }

  /**
   * The stem's own value for Feature_Id `f` in the last merge (before the
   * overlay, after the overrides), or `undefined` when the stem lacks it.
   */
  lastStemValue(f: number): string | undefined {
    return f >= 0 && this.stemStamp[f] === this.epoch ? this.stemVal[f] : undefined;
  }

  /**
   * The key order of a result on `path` for a stem with Layout `layoutId`:
   * the stem's keys (its Layout, then the path's appended overrides), then
   * each key steps (c)–(l) assign that is not yet present, in step order.
   */
  private resultOrder(path: MergePath, layoutId: number, keys: IdArray): Int32Array {
    let order = this.orders[path][layoutId];
    if (order !== undefined) {
      return order;
    }
    const plan = this.plan;
    const seq: number[] = [];
    const seen = new Set<number>();
    const add = (f: number): void => {
      if (f >= 0 && !seen.has(f)) {
        seen.add(f);
        seq.push(f);
      }
    };
    for (const f of keys) {
      add(f);
    }
    // The appended overrides of this call: the stem keys past the Layout.
    for (const f of this.stemKeys) {
      add(f);
    }
    for (const list of [plan.join, plan.concat, plan.concatNone]) {
      for (const f of list) {
        add(f);
      }
    }
    add(plan.stem);
    add(plan.stemgloss);
    add(plan.diac);
    for (const list of [plan.tok1, plan.tok2]) {
      for (const f of list) {
        add(f);
      }
    }
    if (plan.hasCaphi) {
      add(plan.caphi);
    }
    if (plan.computePattern) {
      add(plan.pattern);
    }
    for (const f of plan.logprob) {
      add(f);
    }
    order = Int32Array.from(seq);
    this.orders[path][layoutId] = order;
    return order;
  }
}
