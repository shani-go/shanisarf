// Ported from CAMeL Tools morphology/analyzer.py (version 1.6.0).
// Copyright 2018-2026 New York University Abu Dhabi. MIT License.
// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.
// shanisarf's changes are Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
//
// The morphological analyzer. This file carries the analyzer constants, the
// word classification and the three special paths (digit, punc, foreign) plus
// the Has_Punc fall-through, the lexical combination path, the backoff path
// and the public API, options, cache and batch: the constructor and its
// `AnalyzerError` validations, the `normMap` undefined/null/CharMapper
// resolution, the LFU cache keyed by the stripped word, read-only results,
// `analyzeWords`, `allFeats`/`tokFeats` and upstream's enumeration order.
//
// The port is a line-for-line translation of upstream's `analyzer.py` with
// four systematic changes:
//
//   1. Code points, not code units. Classification regexes carry `u`, and the
//      special paths never index a string; the lexical/backoff paths segment
//      over code-point arrays via `segments`.
//   2. Python string semantics, explicitly. `word.strip()` becomes `pyStrip`
//      (Python_Whitespace, not JavaScript `trim`); the Has_Punc comparison and
//      the special-path field assignments touch whole strings only.
//   3. Regexes translated one by one, with `u`. Upstream builds `_IS_PUNC_RE`
//      and `_HAS_PUNC_RE` from
//      `re.escape(''.join(UNICODE_PUNCT_SYMBOL_CHARSET))`, i.e. the host's
//      `unicodedata` punctuation+symbol set; the port uses the host's `\p{P}`
//      and `\p{S}` instead (`charsets.ts` exposes the fragments), which is
//      where Unicode_Drift can bite. `IS_DIGIT`, `IS_STRICT_DIGIT` and `IS_AR`
//      are translated literally.
//   4. Errors where upstream raises. Upstream's `self._db.defaults['digit']`
//      is a Python subscript that raises `KeyError` when the row is absent;
//      the port raises `AnalyzerError` naming the row.
//
// Two corners are outside parity by statement and carry a comment at their
// site: words containing a line terminator (Python's `.` and `$` in `IS_DIGIT`
// differ from JavaScript's) and emoji sequences outside the UTS #51 pattern
// (the word tokenizer's concern, noted where `IS_AR`/`HAS_PUNC` route
// non-Arabic astral input here).

import { bitsetHas } from './compat-bitset.js';
import { type MorphologyDb, tupleModelOf, type TupleModel } from './database.js';
import { dediacAr } from './dediac.js';
import { AnalyzerError } from './errors.js';
import type { IdArray, KeyIndex } from './feature-schema.js';
import { simpleArToCaphi } from './features.js';
import { CharMapper } from './charmap.js';
import { LfuCache } from './lfu-cache.js';
import { pyStrip } from './python-compat.js';
import { forEachHitSegment } from './segments.js';
import { TupleMerger } from './tuple-merge.js';
import { AR_CLASS, UNICODE_PUNCT_SYMBOL_CLASS } from './charsets.js';

// ---------------------------------------------------------------------------
// Public result types (upstream `AnalyzedWord`; the analysis dict).
// ---------------------------------------------------------------------------

/**
 * One analysis of a word: a feature dictionary. Values are strings for most
 * features, numbers for the three log-probabilities (the merge's step (l) and
 * the special paths' `-99`), or `null` for a `*` default carried through from
 * a `DEFAULTS` row and for `stemcat` on a special path. This is upstream's
 * analysis `dict`; the key set is data-dependent, so the type is an open
 * record rather than a fixed shape.
 */
export type Analysis = Record<string, string | number | null>;

/**
 * A word and its analyses, matching upstream's `AnalyzedWord` named tuple
 * (`analyzeWords` returns one per input). The `analyses` list is in upstream's
 * enumeration order (lexical in loop order, then backoff); the Parity_Harness
 * compares in Canonical_Order.
 */
export interface AnalyzedWord {
  word: string;
  analyses: Analysis[];
}

/**
 * The options the `Analyzer` constructor accepts (upstream's keyword
 * arguments). `backoff` is one of the five modes; `normMap` is `undefined` for
 * the default map, `null` to disable normalization, or a `CharMapper`;
 * `strictDigit` toggles `IS_STRICT_DIGIT` vs `IS_DIGIT`; `cacheSize` sizes the
 * LFU cache (0 disables it). The constructor validates `backoff` and
 * `cacheSize` and that the database supports analysis, and resolves `normMap`.
 */
export interface AnalyzerOptions {
  backoff?: BackoffMode;
  normMap?: CharMapper | null;
  strictDigit?: boolean;
  /**
   * The number of words whose analyses are kept in an LFU cache. **Default 0:
   * no cache**, as in CAMeL Tools.
   *
   * For running text, where words repeat, `cacheSize: 1000` is recommended:
   * on a Zipf-distributed stream (exponent 1.0) it hits 62% of the time and
   * analyzes about 2.7× faster. Each cached word holds about 40 KB of
   * analyses, so a full cache of N words costs about N × 40 KB: about 39 MiB
   * at 1,000, about 385 MiB at 10,000, on top of the model's 98 MiB.
   *
   * With a cache, `analyze` returns the cached array itself on a hit (and on
   * the miss that stored it): callers must not sort, annotate or otherwise
   * change a result, or a later call for the same word returns the change.
   * Copy a result before changing it.
   */
  cacheSize?: number;
}

// ---------------------------------------------------------------------------
// Constants (upstream module-level, verbatim).
// ---------------------------------------------------------------------------

/**
 * The five backoff modes (upstream `_BACKOFF_TYPES`). `NONE` runs no backoff;
 * the other four pair a Backoff_Condition (`NOAN` or `ADD`) with a
 * Backoff_Action (`ALL` or `PROP`), split on `_` as upstream splits.
 */
export type BackoffMode =
  | 'NONE'
  | 'NOAN_ALL'
  | 'NOAN_PROP'
  | 'ADD_ALL'
  | 'ADD_PROP';

/** The set of valid backoff modes (upstream `_BACKOFF_TYPES`). */
export const BACKOFF_MODES: ReadonlySet<BackoffMode> = new Set<BackoffMode>([
  'NONE',
  'NOAN_ALL',
  'NOAN_PROP',
  'ADD_ALL',
  'ADD_PROP',
]);

/**
 * The default normalization map (upstream `DEFAULT_NORMALIZE_MAP`): maps the
 * four alef variants (hamza-below `إ`, hamza-above `أ`, madda `آ`, wasla `ٱ`)
 * to bare alef `ا`, alef maksura `ى` to yaa `ي`, taa marbuta `ة` to haa `ه`,
 * and tatweel/kashida `ـ` to the empty string, and nothing else. Built from a
 * `CharMapper` with no default, so a code point the map does not mention maps
 * to itself.
 */
export const DEFAULT_NORMALIZE_MAP: CharMapper = new CharMapper({
  '\u0625': '\u0627',
  '\u0623': '\u0627',
  '\u0622': '\u0627',
  '\u0671': '\u0627',
  '\u0649': '\u064a',
  '\u0629': '\u0647',
  '\u0640': '',
});

/**
 * Features copied verbatim to the word on a special path (upstream
 * `_COPY_FEATS`): the gloss and the nine tokenization/segmentation features.
 * On a digit/punc/foreign result, each of these that the database defines is
 * set to the word itself.
 */
export const COPY_FEATS: ReadonlySet<string> = new Set([
  'gloss',
  'atbtok',
  'atbseg',
  'd1tok',
  'd1seg',
  'd2tok',
  'd2seg',
  'd3tok',
  'd3seg',
  'bwtok',
]);

/**
 * Lexical features that are undefined on a special path (upstream
 * `_UNDEFINED_LEX_FEATS`): `root`, `pattern`, `caphi`. Each that the database
 * defines is set to the path's marker (`DIGIT`, `PUNC` or `FOREIGN`).
 */
export const UNDEFINED_LEX_FEATS: ReadonlySet<string> = new Set([
  'root',
  'pattern',
  'caphi',
]);

// ---------------------------------------------------------------------------
// Classification regexes (upstream `_IS_*_RE`, `_HAS_PUNC_RE`, `_NOAN_RE`),
// each translated literally with the `u` flag.
// ---------------------------------------------------------------------------

/**
 * `_IS_DIGIT_RE` — a word that contains at least one ASCII or Arabic-Indic
 * digit (upstream `^.*[0-9\u0660-\u0669]+.*$`). Non-parity corner: Python's
 * `.` excludes only `\n` while JavaScript's `.` also excludes `\r`, `\u2028`
 * and `\u2029`, and `$` differs before a final newline, so a word containing a
 * line terminator is outside parity. No Word_List contains one (`scan_text.py`
 * refuses them). The digit ranges are written explicitly rather than with
 * `\d`, which the lint rule forbids and which would match more than upstream's
 * two ranges.
 */
const IS_DIGIT = /^.*[0-9\u0660-\u0669]+.*$/u;

/**
 * `_IS_STRICT_DIGIT_RE` — a word that is entirely ASCII or Arabic-Indic digits
 * (upstream `^[0-9\u0660-\u0669]+$`). Used instead of `IS_DIGIT` when
 * `strictDigit` is on.
 */
const IS_STRICT_DIGIT = /^[0-9\u0660-\u0669]+$/u;

/**
 * `_IS_PUNC_RE` — a word that is entirely punctuation or symbols (upstream
 * `^[<re.escape of UNICODE_PUNCT_SYMBOL_CHARSET>]+$`). The port uses the
 * host's `\p{P}` and `\p{S}` classes rather than a committed table, so which
 * words match can shift with the host's Unicode version (Unicode_Drift,
 * recorded per fixture, never a silent divergence).
 */
const IS_PUNC = new RegExp(`^[${UNICODE_PUNCT_SYMBOL_CLASS}]+$`, 'u');

/**
 * `_HAS_PUNC_RE` — a word that contains any punctuation or symbol (upstream
 * `[<re.escape of UNICODE_PUNCT_SYMBOL_CHARSET>]`). As with `IS_PUNC`, the port
 * uses the host's classes.
 */
const HAS_PUNC = new RegExp(`[${UNICODE_PUNCT_SYMBOL_CLASS}]`, 'u');

/**
 * `_IS_AR_RE` — a word that is entirely Arabic letters and diacritics
 * (upstream `^[<re.escape of AR_CHARSET>]+$`). Built from `charsets.ts`'s
 * `AR_CLASS` fragment, so the two sides share one definition of the Arabic
 * character set. A non-Arabic word (Latin, Cyrillic, CJK, an emoji outside the
 * UTS #51 pattern — the second non-parity corner) fails this and takes the
 * foreign path.
 */
const IS_AR = new RegExp(`^[${AR_CLASS}]+$`, 'u');

// `_NOAN_RE` — the No-Analysis marker, applied with a function replacer so the
// substituted stem surface is inert (a `$` in it is never a template; a stem
// surface never contains a backslash anyway). Used by the backoff path;
// declared here with the other classification regexes to keep the literal
// translations together.
const NOAN = /NOAN/gu;

// ---------------------------------------------------------------------------
// Classification predicates (upstream `_is_digit` … `_is_ar`).
// ---------------------------------------------------------------------------

/** `_is_digit` — the word contains a digit (upstream `IS_DIGIT.match`). */
function isDigit(word: string): boolean {
  return IS_DIGIT.test(word);
}

/** `_is_strict_digit` — the word is all digits (upstream `IS_STRICT_DIGIT`). */
function isStrictDigit(word: string): boolean {
  return IS_STRICT_DIGIT.test(word);
}

/** `_is_punc` — the word is all punctuation/symbols (upstream `IS_PUNC`). */
function isPunc(word: string): boolean {
  return IS_PUNC.test(word);
}

/** `_has_punc` — the word contains a punctuation/symbol (upstream `IS_PUNC.search`). */
function hasPunc(word: string): boolean {
  return HAS_PUNC.test(word);
}

/** `_is_ar` — the word is all Arabic letters/diacritics (upstream `IS_AR`). */
function isAr(word: string): boolean {
  return IS_AR.test(word);
}

// ---------------------------------------------------------------------------
// The analyzer.
// ---------------------------------------------------------------------------

/**
 * The morphological analyzer (upstream `Analyzer`). Built over `db` with
 * options `{ backoff, normMap, strictDigit, cacheSize }`; `analyze(word)`
 * returns the word's analyses in upstream's enumeration order, and
 * `analyzeWords`, `allFeats` and `tokFeats` complete the public API.
 *
 * `analyze` strips with Python semantics, classifies through the branch chain
 * (digit, punc, has-punc, foreign, lexical), runs the backoff step when the
 * mode calls for it, and — when `cacheSize > 0` — memoizes the result in an
 * LFU cache keyed by the stripped word. The cache is output-transparent and
 * the returned arrays are read-only.
 */
export class Analyzer {
  /** The database this analyzer reads (upstream `self._db`). */
  private readonly db: MorphologyDb;

  /** The backoff mode (upstream `self._backoff`). */
  private readonly backoff: BackoffMode;

  /** The Backoff_Condition (`NOAN`/`ADD`) or `null` for `NONE`. */
  private readonly backoffCondition: 'NOAN' | 'ADD' | null;

  /** The Backoff_Action (`ALL`/`PROP`) or `null` for `NONE`. */
  private readonly backoffAction: 'ALL' | 'PROP' | null;

  /** Whether only all-digit words count as numbers (upstream `self._strict_digit`). */
  private readonly strictDigit: boolean;

  /**
   * The normalization map, or `null` to disable normalization. Upstream
   * substitutes `DEFAULT_NORMALIZE_MAP` for a `None` argument in the
   * constructor; the port's option takes `undefined` for the default and
   * `null` for off, and this field holds the resolved map.
   */
  private readonly normMap: CharMapper | null;

  /**
   * The LFU cache, or `null` when `cacheSize` is not positive (upstream wraps
   * `analyze` in `cachetools.LFUCache` only when the size is positive). Keyed
   * by `pyStrip(word)`, consulted in `analyze` around `computeAnalyses`.
   */
  private readonly cache: LfuCache<Analysis[]> | null;

  /** The tuple model the lexical and backoff paths read. */
  private readonly model: TupleModel;

  /** The merge over the model, with its scratch. */
  private readonly merger: TupleMerger;

  /** Stem role id → its category name. */
  private readonly stemCatNames: readonly string[];

  /**
   * The backoff stems: the `NOAN` stem entries whose category is in
   * `db.stemBackoffs[action]`, in line order, empty without a backoff action.
   * Upstream filters them per call; the model never changes after
   * construction, so they are filtered once.
   */
  private readonly backoffStems: Uint32Array;

  /**
   * Build an analyzer over `db` with `options` (upstream `__init__`).
   *
   * Resolves and validates the four options in upstream's order: the database
   * must support analysis (upstream checks `db.flags['analysis']` and raises
   * `AnalyzerError('DB does not support analysis')`); `normMap` is resolved
   * (`undefined` → the default map, `null` → off, a `CharMapper` → that map;
   * upstream substitutes the default for a `None` argument); the backoff mode
   * must be one of the five (upstream raises `AnalyzerError` naming the bad
   * mode) and is split into its condition and action (`backoff.split('_')`,
   * `NONE` having neither); and `cacheSize` must be an integer (upstream
   * raises `AnalyzerError` naming the bad size) and, when positive, sizes the
   * LFU cache. The defaults match upstream: `NONE`, the default map, `false`,
   * `0`.
   *
   * The error messages mirror upstream's `__init__` messages so a caller sees
   * the same text: `DB does not support analysis`, `Invalid backoff mode
   * '<mode>'`, `Invalid cache size <size>`.
   */
  constructor(db: MorphologyDb, options: AnalyzerOptions = {}) {
    this.db = db;
    this.model = tupleModelOf(db);

    // The database must have been parsed for analysis.
    // Upstream raises `AnalyzerError('DB does not support analysis')` when
    // `db.flags['analysis']` is false.
    if (!db.flags.analysis) {
      throw new AnalyzerError('DB does not support analysis');
    }

    this.strictDigit = options.strictDigit ?? false;

    // `undefined` → the default map; `null` → normalization off; a
    // `CharMapper` → that map. Upstream substitutes `DEFAULT_NORMALIZE_MAP`
    // for a `None` argument; the port's option encodes "the default" as
    // `undefined` and "off" as `null`.
    if (options.normMap === undefined) {
      this.normMap = DEFAULT_NORMALIZE_MAP;
    } else {
      this.normMap = options.normMap;
    }

    const backoff = options.backoff ?? 'NONE';

    // The backoff mode must be one of the five. Upstream raises
    // `AnalyzerError('Invalid backoff mode {}'.format(repr(backoff)))`;
    // Python's `repr` of a string wraps it in single quotes, mirrored here.
    if (!BACKOFF_MODES.has(backoff)) {
      throw new AnalyzerError(`Invalid backoff mode '${String(backoff)}'`);
    }
    this.backoff = backoff;

    // Split the backoff mode into condition and action, as upstream's
    // `backoff.split('_')` does; `NONE` has neither.
    if (backoff === 'NONE') {
      this.backoffCondition = null;
      this.backoffAction = null;
    } else {
      const toks = backoff.split('_');
      this.backoffCondition = toks[0] as 'NOAN' | 'ADD';
      this.backoffAction = toks[1] as 'ALL' | 'PROP';
    }

    // The cache size must be an integer. Upstream guards on
    // `isinstance(cache_size, int)` and raises `AnalyzerError('Invalid cache
    // size {}'.format(repr(cache_size)))` otherwise; the port rejects a
    // non-integer number (and a `NaN`/`Infinity`) with the matching message.
    const cacheSize = options.cacheSize ?? 0;
    if (!Number.isInteger(cacheSize)) {
      throw new AnalyzerError(`Invalid cache size ${String(cacheSize)}`);
    }
    // Upstream wraps `analyze` in `cachetools.LFUCache(cache_size)` only when
    // the size is positive; a non-positive integer leaves the cache off.
    this.cache = cacheSize > 0 ? new LfuCache<Analysis[]>(cacheSize) : null;

    const model = this.model;
    const strings = model.strings.strings;
    this.merger = new TupleMerger(model);
    this.stemCatNames = Array.from(model.header.stemCats.names, (id) => strings[id] as string);

    // The Backoff_Action selects the categories, and the backoff stems are the
    // `NOAN` entries filtered to those categories. Upstream reads
    // `self._db.stem_hash['NOAN']` directly, which would raise a Python
    // `KeyError` were the `NOAN` surface absent (no caller handles it); the
    // port treats an absent `NOAN` surface as no entries, so a database
    // without backoff stems produces no backoff analyses.
    const backoffCats = this.backoffAction === null ? undefined : db.stemBackoffs.get(this.backoffAction);
    const stemIndex = model.stem.stemIndex as KeyIndex;
    const noanSlot = stemIndex.slots.get('NOAN');
    const backoffStems: number[] = [];
    if (backoffCats !== undefined && noanSlot !== undefined) {
      for (let k = stemIndex.start[noanSlot] as number; k < (stemIndex.start[noanSlot + 1] as number); k++) {
        const id = stemIndex.ids[k] as number;
        if (backoffCats.includes(this.stemCatNames[model.stem.stems.category[id] as number] as string)) {
          backoffStems.push(id);
        }
      }
    }
    this.backoffStems = Uint32Array.from(backoffStems);
  }

  /**
   * `_normalize` — apply the normalization map to a word, or return it
   * unchanged when normalization is off (upstream returns the word when the
   * map is `None`).
   */
  private normalize(word: string): string {
    if (this.normMap === null) {
      return word;
    }
    return this.normMap.mapString(word);
  }

  /**
   * Analyze a word (upstream `analyze`).
   *
   * Strips with Python semantics and returns `[]` for the empty result, then
   * classifies by the first matching branch in the order digit, punc,
   * has-punc, foreign, lexical, using `IS_STRICT_DIGIT` when `strictDigit` is
   * on and `IS_DIGIT` otherwise. The digit, punc and foreign branches return
   * one special-path analysis each; has-punc performs no lexical lookup and
   * falls through to backoff.
   *
   * **Enumeration order.** The returned analyses are in upstream's enumeration
   * order: the lexical analyses in the order the segmentation and the
   * prefix-outer/stem-inner/suffix compatibility loops emit them, then the
   * backoff analyses in the same loop order, appended after. The
   * Parity_Harness compares the two sides in Canonical_Order so the engine is
   * free to re-rank; this method preserves upstream's order so that comparison
   * and any out-of-context ranking start from the same list.
   *
   * **Caching.** When `cacheSize > 0` the result is cached in an LFU cache
   * keyed by the **stripped** word, `pyStrip(word)`, so a word with and
   * without surrounding Python_Whitespace shares one entry. Upstream wraps
   * `analyze` in `cachetools.LFUCache` keyed by the raw argument; the two keys
   * differ only in which calls share an entry, never in what a result
   * contains. A word that strips to empty returns `[]` without consulting or
   * filling the cache. A cache hit returns the stored array; a miss computes,
   * stores and returns it. The cache changes nothing but speed: for any
   * sequence of calls a cached analyzer returns what an uncached one returns.
   *
   * **Read-only results.** The returned array is the analyzer's own: on a
   * cache hit the very array a prior call stored is handed back (upstream
   * returns the cached object too). Callers **must not mutate** a returned
   * analysis or the array holding it; doing so corrupts a later cached result
   * for the same word. Treat the result as read-only, or copy it before
   * mutating.
   */
  analyze(word: string): Analysis[] {
    // Python strip (not JavaScript `trim`), empty → []. The strip happens once
    // per call, and an empty result never touches the cache.
    const stripped = pyStrip(word);
    if (stripped === '') {
      return [];
    }

    // The cache is keyed by the stripped word. A hit returns the stored array
    // as-is (callers must not mutate it).
    if (this.cache !== null) {
      const cached = this.cache.get(stripped);
      if (cached !== undefined) {
        return cached;
      }
    }

    const result = this.computeAnalyses(stripped);

    if (this.cache !== null) {
      this.cache.set(stripped, result);
    }

    return result;
  }

  /**
   * The uncached body of `analyze` (upstream's `analyze` before the
   * `cachetools.cached` wrapper is applied), over the already stripped,
   * non-empty word. Split out so `analyze` can consult the cache around it;
   * the classification, special paths, lexical combination and backoff all
   * live here.
   */
  private computeAnalyses(stripped: string): Analysis[] {
    // Dediac then normalize (or the dediac'd word itself when normalization is
    // off).
    const wordDediac = dediacAr(stripped);
    const wordNormal = this.normalize(wordDediac);

    const analyses: Analysis[] = [];

    // The branch order is digit, punc, has-punc, foreign, lexical, first match
    // wins.
    if (
      (this.strictDigit && isStrictDigit(stripped)) ||
      (!this.strictDigit && isDigit(stripped))
    ) {
      // The digit path.
      return [this.specialPath(stripped, 'digit')];
    } else if (isPunc(stripped)) {
      // The punc path.
      return [this.specialPath(stripped, 'punc')];
    } else if (hasPunc(stripped)) {
      // Has-punc: no lexical lookup; fall through to the backoff step.
      // Upstream's `elif _has_punc(word): pass` leaves `analyses` empty and
      // lets the backoff `if` below run.
    } else if (!isAr(stripped)) {
      // The foreign path. A non-Arabic word reaches here; an emoji sequence
      // outside the UTS #51 pattern is the second non-parity corner and is
      // outside every Word_List.
      return [this.specialPath(stripped, 'foreign')];
    } else {
      // Lexical path: the hit segmentations of `wordNormal`, the AB/BC/AC
      // checks and the merge over Tuples.
      this.analyzeLexical(wordNormal, wordDediac, analyses);
    }

    // Backoff step: runs when the Backoff_Condition is `NOAN` and no analysis
    // has been produced, or when it is `ADD` — including after the has-punc
    // branch, since this `if` sits outside the branch chain.
    if (
      (this.backoffCondition === 'NOAN' && analyses.length === 0) ||
      this.backoffCondition === 'ADD'
    ) {
      this.analyzeBackoff(wordNormal, wordDediac, analyses);
    }

    return analyses;
  }

  /**
   * Build a special-path analysis for the digit, punc or foreign branch
   * (upstream's three near-identical blocks in `analyze`). The three differ
   * only in the default row they copy, the `bw` suffix, the `source`, the
   * `UNDEFINED_LEX_FEATS` marker and the `catib6`/`ud` values and `pos`; this
   * method parameterizes those and shares the rest, which is a safe
   * refactoring of upstream's copy-pasted blocks (the output is identical).
   *
   * Raises `AnalyzerError` when the default row is absent (upstream's
   * `KeyError` on `self._db.defaults['digit']`).
   */
  private specialPath(
    word: string,
    kind: 'digit' | 'punc' | 'foreign',
  ): Analysis {
    // The per-kind constants: the DEFAULTS row key, the `bw` POS suffix, the
    // `source`, the UNDEFINED_LEX_FEATS marker, and `catib6`/`ud`.
    const spec = SPECIAL_PATHS[kind];

    // The default row must exist. Upstream subscripts the defaults dict and
    // would raise KeyError; the port raises AnalyzerError naming the row at
    // the time this branch is taken.
    const defaultRow = this.db.defaults.get(spec.row);
    if (defaultRow === undefined) {
      throw new AnalyzerError(
        `Missing '${spec.row}' default row required for the ${kind} path`,
      );
    }

    // `copy.copy(self._db.defaults[...])`: a shallow copy so the model's row is
    // never mutated. The row's values are `string | null`; the result widens
    // to `string | number | null` as the log-probabilities and `stemcat` are
    // set below.
    const result: Analysis = { ...defaultRow };

    // Common fields (upstream sets these identically on all three paths).
    result['diac'] = word;
    result['stem'] = word;
    result['stemgloss'] = word;
    result['stemcat'] = null;
    result['lex'] = word;
    result['bw'] = word + spec.bwSuffix;
    result['source'] = spec.source;

    // The foreign path also overrides `pos` (upstream `result['pos'] =
    // 'foreign'`); digit and punc keep the row's `pos`.
    if (spec.pos !== undefined) {
      result['pos'] = spec.pos;
    }

    // COPY_FEATS: each defined feature set to the word.
    for (const feat of COPY_FEATS) {
      if (this.db.defines.has(feat)) {
        result[feat] = word;
      }
    }

    // UNDEFINED_LEX_FEATS: each defined feature set to the path's marker.
    for (const feat of UNDEFINED_LEX_FEATS) {
      if (this.db.defines.has(feat)) {
        result[feat] = spec.marker;
      }
    }

    // catib6/ud, when defined.
    if (this.db.defines.has('catib6')) {
      result['catib6'] = spec.catib6;
    }
    if (this.db.defines.has('ud')) {
      result['ud'] = spec.ud;
    }

    // The three log-probabilities (upstream sets them to -99.0 unconditionally
    // on the special paths).
    result['pos_logprob'] = -99.0;
    result['lex_logprob'] = -99.0;
    result['pos_lex_logprob'] = -99.0;

    // The form_gen/form_num fix (the merge's step (j), applied here directly
    // because the special paths do not merge).
    if (this.db.defines.has('form_gen') && result['gen'] === '-') {
      result['gen'] = result['form_gen'] ?? null;
    }
    if (this.db.defines.has('form_num') && result['num'] === '-') {
      result['num'] = result['form_num'] ?? null;
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // The lexical and backoff paths, called from `computeAnalyses`.
  // -------------------------------------------------------------------------

  /**
   * The lexical combination path. Iterates the splits of `segments(wordNormal,
   * db.maxPrefixSize, db.maxSuffixSize)` (pruned: `forEachHitSegment`), skips
   * triples whose prefix/suffix/stem surfaces lack entries, and delegates each
   * surviving triple to `combine`, which runs the AB/BC/AC checks, merges and
   * appends analyses to `out` in loop order. The surfaces are looked up in the
   * tuple model's surface indexes.
   *
   * @param wordNormal the normalized word segmentation runs over
   * @param wordDediac the dediacritized word the `spvar` rule compares against
   * @param out the analysis list to append to, in loop order
   */
  private analyzeLexical(
    wordNormal: string,
    wordDediac: string,
    out: Analysis[],
  ): void {
    // The `spvar` rule's left side, upstream's `word_dediac.replace('\u0640',
    // '')`: the same for every merge of this word, so it is computed once here
    // rather than per analysis.
    const wordBare = wordDediac.replace(/\u0640/gu, '');
    const h = this.model.header;
    const prefixSlots = (h.prefixIndex as KeyIndex).slots;
    const suffixSlots = (h.suffixIndex as KeyIndex).slots;
    const stemSlots = (this.model.stem.stemIndex as KeyIndex).slots;

    // Enumerate every prefix/stem/suffix split of the normalized word, bounded
    // by the database's longest affixes, and keep a triple only when all three
    // surfaces carry entries. Upstream looks the three surfaces up in
    // `prefix_hash`, `suffix_hash` and `stem_hash` and `continue`s past a
    // split any of them misses. The pruned enumeration looks each prefix and
    // suffix up once per word and visits, in `segments` order, only the splits
    // both hit; the lookups have no effects, so their order does not matter.
    forEachHitSegment(
      wordNormal,
      this.db.maxPrefixSize,
      this.db.maxSuffixSize,
      (prefix) => prefixSlots.get(prefix) ?? -1,
      (suffix) => suffixSlots.get(suffix) ?? -1,
      (prefixSlot, stem, suffixSlot) => {
        const stemSlot = stemSlots.get(stem);
        if (stemSlot !== undefined) {
          this.combine(wordBare, prefixSlot, stemSlot, suffixSlot, out);
        }
      },
    );
  }

  /**
   * `combine` — the AB/BC/AC compatibility product of one triple's prefix,
   * stem and suffix entries (upstream's inner three loops in `analyze`), over
   * the entry ids of the three surface slots.
   *
   * Prefix entries are the outer loop and stem entries the inner loop, so
   * analyses come out in upstream's order. For each prefix–stem pair the stem
   * category must be compatible with the prefix category in AB; for each
   * suffix the stem category must list the suffix category in BC and the
   * prefix category must list it in AC. The tests are bitset tests over role
   * ids, where a row the table never names is all zeros: an **absent** prefix
   * or stem category is an empty compatible set, not an error (upstream
   * subscripts `prefix_stem_compat[prefix_cat]` and would raise a Python
   * `KeyError` here, which no caller handles).
   *
   * A passing triple is merged over the tuples, its `stem`/`stemcat` set from
   * the stem entry, and its `source` set to `spvar` when the dediac rule
   * fires. Results are appended to `out` in loop order.
   *
   * @param wordBare the dediacritized word with every tatweel removed, the
   *   left side of the `spvar` comparison
   */
  private combine(
    wordBare: string,
    prefixSlot: number,
    stemSlot: number,
    suffixSlot: number,
    out: Analysis[],
  ): void {
    const model = this.model;
    const h = model.header;
    const stems = model.stem.stems;
    const prefixIndex = h.prefixIndex as KeyIndex;
    const stemIndex = model.stem.stemIndex as KeyIndex;
    const suffixIndex = h.suffixIndex as KeyIndex;
    const merger = this.merger;
    const diacFeature = merger.plan.diac;

    for (let i = prefixIndex.start[prefixSlot] as number; i < (prefixIndex.start[prefixSlot + 1] as number); i++) {
      const prefix = prefixIndex.ids[i] as number;
      const prefixCat = h.prefixes.category[prefix] as number;

      for (let j = stemIndex.start[stemSlot] as number; j < (stemIndex.start[stemSlot + 1] as number); j++) {
        const stem = stemIndex.ids[j] as number;
        const stemCat = stems.category[stem] as number;
        // AB: the stem category must be compatible with the prefix category.
        if (!bitsetHas(h.ab, prefixCat, stemCat)) {
          continue;
        }

        for (let k = suffixIndex.start[suffixSlot] as number; k < (suffixIndex.start[suffixSlot + 1] as number); k++) {
          const suffix = suffixIndex.ids[k] as number;
          const suffixCat = h.suffixes.category[suffix] as number;
          // BC and AC: the suffix category must be listed for the stem (BC)
          // and for the prefix (AC).
          if (!bitsetHas(h.bc, stemCat, suffixCat) || !bitsetHas(h.ac, prefixCat, suffixCat)) {
            continue;
          }

          // Merge, then set the stem surface and category from the stem entry.
          const merged = merger.merge('lexical', prefix, stem, suffix) as Analysis;
          merged['stem'] = merger.lastStemValue(diacFeature) ?? '';
          merged['stemcat'] = this.stemCatNames[stemCat] as string;

          // The spvar rule: when the dediacritized word with every tatweel (ـ,
          // U+0640) removed differs from the dediac of the merged diacritized
          // form, the surface is a spelling variant. Upstream compares
          // `word_dediac.replace('\u0640', '')` (`wordBare`) to
          // `dediac_ar(merged['diac'])`.
          const diac = merged['diac'];
          if (typeof diac === 'string' && wordBare !== dediacAr(diac)) {
            merged['source'] = 'spvar';
          }

          // Append in loop order.
          out.push(merged);
        }
      }
    }
  }

  /**
   * The backoff path. Uses the `NOAN` stem entries whose category is in
   * `db.stemBackoffs[action]` (filtered once in the constructor), iterates
   * `segments(wordNormal, …)` skipping triples whose prefix or suffix surface
   * has no entries, and delegates each surviving triple to `combineBackoff`
   * with the **stem surface segment** — not an entry — as the substitution
   * text. Backoff analyses are appended to `out` after any lexical analyses,
   * in loop order.
   *
   * @param wordNormal the normalized word segmentation runs over
   * @param wordDediac the dediacritized word (threaded to mirror the lexical
   *   seam's signature; the backoff combination does not use it)
   * @param out the analysis list to append to, after any lexical analyses
   */
  private analyzeBackoff(
    wordNormal: string,
    wordDediac: string,
    out: Analysis[],
  ): void {
    const h = this.model.header;
    const prefixSlots = (h.prefixIndex as KeyIndex).slots;
    const suffixSlots = (h.suffixIndex as KeyIndex).slots;

    // Iterate every segmentation of the normalized word, keeping a triple only
    // when both affix surfaces carry entries (the pruned enumeration, as on
    // the lexical path). The stem surface is not looked up — the backoff stems
    // stand in for it — but its segment is the text substituted for `NOAN`.
    forEachHitSegment(
      wordNormal,
      this.db.maxPrefixSize,
      this.db.maxSuffixSize,
      (prefix) => prefixSlots.get(prefix) ?? -1,
      (suffix) => suffixSlots.get(suffix) ?? -1,
      (prefixSlot, stem, suffixSlot) => this.combineBackoff(stem, prefixSlot, suffixSlot, out),
    );
  }

  /**
   * `_combined_backoff_analyses` — the AB/BC/AC product of one triple's prefix
   * entries, the backoff `NOAN` stem entries and the triple's suffix entries,
   * substituting the stem **surface segment** into each stem's `bw`/`diac`/
   * `lex`.
   *
   * Prefix entries are the outer loop and backoff stem entries the inner loop,
   * matching upstream's `itertools.product(prefix_analyses, stem_analyses)`,
   * so analyses come out in upstream's order. For each prefix–stem pair the
   * stem's features are **copied** so the `NOAN` substitutions change the
   * copy, not the model's shared entry, and later suffixes in the same pair
   * see the substituted strings as upstream does. The copy is the four strings
   * it changes, `bw`, `diac`, `lex` and `caphi`, handed to the tuple merge as
   * overrides, which put a key the stem lacks after its own keys in that
   * order, where the copy's assignments would.
   *
   * The compatibility checks are upstream's, as bitset tests (an absent row
   * admits nothing). Under the `PROP` action a stem whose `bw` does not
   * contain `NOUN_PROP` is skipped; the check reads the copy's `bw` before the
   * `NOAN` substitution, as upstream does.
   *
   * A passing triple substitutes every `NOAN` → the stem segment in the copy's
   * `bw`, `diac` and `lex` (with a function replacer so the segment text is
   * inert), sets `caphi` to `simpleArToCaphi(stem)` (the stem segment, not the
   * copy's `diac`), merges, and sets
   * `stem`/`stemcat`/`source`/`pattern`/`gloss` as upstream does (the merged
   * `gloss` from the joins is overwritten by the copy's).
   *
   * Hoists that leave the output unchanged: the copy is made when a suffix
   * first passes (until then it equals the entry, so the `PROP` check reads
   * the entry), and the segment's CAPHI is computed once per call.
   *
   * @param stem the stem surface segment substituted for `NOAN`
   * @param prefixSlot the triple's prefix surface slot (outer loop)
   * @param suffixSlot the triple's suffix surface slot
   * @param out the analysis list to append to, in loop order
   */
  private combineBackoff(
    stem: string,
    prefixSlot: number,
    suffixSlot: number,
    out: Analysis[],
  ): void {
    // The function replacer makes the substituted stem segment inert: a `$` in
    // it is never a replacement template (a stem surface never carries a
    // backslash anyway), matching Python's `re.sub(stem, …)` with a literal
    // replacement. `NOAN` is the module-level global regex.
    const replaceNoan = (s: string): string => s.replace(NOAN, () => stem);
    const prop = this.backoffAction === 'PROP';
    let stemCaphi: string | undefined;
    const model = this.model;
    const h = model.header;
    const stems = model.stem.stems;
    const prefixIndex = h.prefixIndex as KeyIndex;
    const suffixIndex = h.suffixIndex as KeyIndex;
    const merger = this.merger;
    const plan = merger.plan;

    for (let i = prefixIndex.start[prefixSlot] as number; i < (prefixIndex.start[prefixSlot + 1] as number); i++) {
      const prefix = prefixIndex.ids[i] as number;
      const prefixCat = h.prefixes.category[prefix] as number;

      for (const backoffStem of this.backoffStems) {
        const stemCat = stems.category[backoffStem] as number;
        // AB: the stem category must be compatible with the prefix category.
        if (!bitsetHas(h.ab, prefixCat, stemCat)) {
          continue;
        }

        // The per-pair copy of `bw`, `diac` and `lex`, made when a suffix
        // first passes.
        let copied = false;
        let bw: string | undefined;
        let diac: string | undefined;
        let lex: string | undefined;

        for (let k = suffixIndex.start[suffixSlot] as number; k < (suffixIndex.start[suffixSlot + 1] as number); k++) {
          const suffix = suffixIndex.ids[k] as number;
          const suffixCat = h.suffixes.category[suffix] as number;
          // BC and AC: the suffix category must be in BC for the stem and in
          // AC for the prefix.
          if (!bitsetHas(h.bc, stemCat, suffixCat) || !bitsetHas(h.ac, prefixCat, suffixCat)) {
            continue;
          }

          // Under PROP, skip a stem whose `bw` lacks `NOUN_PROP`. Read before
          // the substitution, as upstream reads it.
          if (
            prop &&
            !((copied ? bw : this.stemValue(backoffStem, plan.bw)) ?? '').includes('NOUN_PROP')
          ) {
            continue;
          }

          if (!copied) {
            bw = this.stemValue(backoffStem, plan.bw);
            diac = this.stemValue(backoffStem, plan.diac);
            lex = this.stemValue(backoffStem, plan.lex);
            copied = true;
          }

          // Substitute every `NOAN` → the stem segment in `bw`/`diac`/`lex` in
          // place on the copy, so a later suffix in this same prefix–stem pair
          // sees the already-substituted strings (upstream mutates
          // `stem_feats` across the suffix loop).
          bw = replaceNoan(bw ?? '');
          diac = replaceNoan(diac ?? '');
          lex = replaceNoan(lex ?? '');
          // `caphi` from the stem segment itself (upstream
          // `simple_ar_to_caphi(stem)`), not from the copy's `diac`.
          stemCaphi ??= simpleArToCaphi(stem);

          const merged = merger.merge('backoff', prefix, backoffStem, suffix, [
            [plan.bw, bw],
            [plan.diac, diac],
            [plan.lex, lex],
            [plan.caphi, stemCaphi],
          ]) as Analysis;

          // The backoff markers. `stem` is the copy's substituted `diac`;
          // `gloss` overwrites the join with the copy's.
          merged['stem'] = diac;
          merged['stemcat'] = this.stemCatNames[stemCat] as string;
          merged['source'] = 'backoff';
          merged['pattern'] = 'backoff';
          merged['gloss'] = this.stemValue(backoffStem, plan.gloss) ?? '';

          // Append in loop order.
          out.push(merged);
        }
      }
    }
  }

  /** Stem entry `stem`'s value for Feature_Id `f`, or `undefined` when it has none. */
  private stemValue(stem: number, f: number): string | undefined {
    const model = this.model;
    const stems = model.stem.stems;
    const keys = model.header.schema.layouts[stems.layout[stem] as number] as IdArray;
    for (let p = 0; p < keys.length; p++) {
      if (keys[p] === f) {
        return model.strings.strings[stems.values[(stems.valueStart[stem] as number) + p] as number];
      }
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Batch and query API (upstream `analyze_words`, `all_feats`, `tok_feats`).
  // -------------------------------------------------------------------------

  /**
   * Analyze a list of words (upstream `analyze_words`). Returns one
   * `AnalyzedWord` (`{ word, analyses }`) per input, **in input order**, where
   * each `analyses` is exactly `analyze(word)` for that word. Upstream is
   * `list(map(lambda w: AnalyzedWord(w, self.analyze(w)), words))`; the port
   * maps the same way, so batch analysis and per-word analysis agree and the
   * cache (if any) is consulted per word just as a direct call would.
   *
   * The `analyses` arrays are the analyzer's own (shared with the cache when
   * caching is on); the read-only contract of `analyze` applies to them.
   */
  analyzeWords(words: readonly string[]): AnalyzedWord[] {
    return words.map((word) => ({ word, analyses: this.analyze(word) }));
  }

  /**
   * The set of all feature names the database provides (upstream `all_feats`,
   * which forwards to `self._db.all_feats()`). Delegates to the model's
   * `allFeats()`, which returns a fresh set of the `defines` keys so a caller
   * mutating the result cannot disturb the model.
   */
  allFeats(): Set<string> {
    return this.db.allFeats();
  }

  /**
   * The set of tokenization feature names the database provides (upstream
   * `tok_feats`, which forwards to `self._db.tok_feats()`). Delegates to the
   * model's `tokFeats()`, which returns a fresh copy of the tokenizations set.
   */
  tokFeats(): Set<string> {
    return this.db.tokFeats();
  }
}

// ---------------------------------------------------------------------------
// Special-path specifications (the per-kind constants of upstream's three
// `analyze` blocks). Factoring them into one table keeps the three paths in
// step and makes the one-line differences between them legible; the resulting
// analyses are byte-for-byte what upstream's copy-pasted blocks produce.
// ---------------------------------------------------------------------------

interface SpecialPathSpec {
  /** The DEFAULTS row key (`digit`, `punc`, `latin`). */
  row: string;
  /** The `/POS` suffix appended to the word for `bw`. */
  bwSuffix: string;
  /** The `source` value. */
  source: string;
  /** The UNDEFINED_LEX_FEATS marker (`DIGIT`, `PUNC`, `FOREIGN`). */
  marker: string;
  /** The `catib6` value when defined. */
  catib6: string;
  /** The `ud` value when defined. */
  ud: string;
  /** The `pos` override, or `undefined` to keep the row's `pos` (foreign only). */
  pos?: string;
}

const SPECIAL_PATHS: Record<'digit' | 'punc' | 'foreign', SpecialPathSpec> = {
  digit: {
    row: 'digit',
    bwSuffix: '/NOUN_NUM',
    source: 'digit',
    marker: 'DIGIT',
    catib6: 'NOM',
    ud: 'NUM',
  },
  punc: {
    row: 'punc',
    bwSuffix: '/PUNC',
    source: 'punc',
    marker: 'PUNC',
    catib6: 'PNX',
    ud: 'PUNCT',
  },
  foreign: {
    row: 'latin',
    bwSuffix: '/FOREIGN',
    source: 'foreign',
    marker: 'FOREIGN',
    catib6: 'FOREIGN',
    ud: 'X',
    pos: 'foreign',
  },
};
