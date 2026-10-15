// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Shared support for the parity replays: find the git-ignored Database_Pin
// under `data/`, verify its SHA-256 against each fixture's header, parse it
// once per worker, and read the gzipped fixtures. When `SHANISARF_PARITY_ASSET`
// names a directory (`npm run parity:asset`), the replays load their model
// from that Asset through the Node entry's `loadDatabase` instead, and check
// each fixture against the Manifest's `sourceSha256`; a missing or broken
// Asset fails the replay, it never skips.

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadDatabase as loadAsset } from '../../src/load/read-asset-node.js';

import {
  Analyzer,
  type Analysis,
  type BackoffMode,
  type MorphologyDb,
  parseAlmor,
} from '../../src/engine/index.js';
import {
  AR_CLASS,
  UNICODE_PUNCT_SYMBOL_CLASS,
} from '../../src/engine/charsets.js';
import { pyStrip } from '../../src/engine/python-compat.js';
import { dediacAr } from '../../src/engine/dediac.js';
import { expect } from 'vitest';

import { type Analysis as CanonicalAnalysis, canonicalKey } from './canonical';

/** Absolute path to the git-ignored Database_Pin under `data/`. */
export const DB_PATH = fileURLToPath(
  new URL('../../data/camel-morph-msa/msa-v1.0.db', import.meta.url),
);

/** Absolute path to the committed `fixtures/parity/` directory. */
export const FIXTURES_DIR = fileURLToPath(
  new URL('../../fixtures/parity', import.meta.url),
);

/**
 * Absolute path to the generation fixtures. The analyzer
 * replay's listing of `fixtures/parity/*.json.gz` is not recursive, so it never
 * reads these.
 */
export const GENERATION_DIR = fileURLToPath(
  new URL('../../fixtures/parity/generation', import.meta.url),
);

/** The command the skip notice points developers at. */
export const SETUP_HINT = 'npm run parity:setup';

/** The header a fixture file carries. */
export interface FixtureDatabase {
  name: string;
  version: string;
  commit: string;
  sha256: string;
}

/** The analyzer configuration a fixture was generated under. */
export interface FixtureAnalyzer {
  backoff: BackoffMode;
  /** `"default"` on every committed fixture; `null` would mean off. */
  normMap: 'default' | null;
  strictDigit: boolean;
}

/** One Unicode_Drift entry: a word the host and CAMeL Tools classify apart. */
export interface DriftEntry {
  word: string;
  reference: string;
  host: string;
  hostUnicode?: string;
}

/** One analyzer-fixture case: a word and CAMeL Tools' analyses in order. */
export interface AnalyzerCase {
  word: string;
  analyses: Analysis[];
}

/** A parsed analyzer fixture (`<list>.<backoff>[.strict].json.gz`). */
export interface AnalyzerFixture {
  file: string;
  database: FixtureDatabase;
  analyzer: FixtureAnalyzer;
  wordList: { name: string; notice: string };
  knownDrift: DriftEntry[];
  cases: AnalyzerCase[];
}

/** One tokenizer-fixture case: an input and its tokens in both modes. */
export interface TokenizerCase {
  input: string;
  tokens: string[];
  tokensSplitDigits: string[];
}

/** A parsed tokenizer fixture (`word-tokenizer.json.gz`). */
export interface TokenizerFixture {
  file: string;
  database: FixtureDatabase;
  cases: TokenizerCase[];
}

/**
 * One generation-fixture case: a request and either CAMeL Tools' analyses in Canonical_Order, the error it raised, or
 * (`referenceRaises`) the Defined_Twin's analyses where it raised `KeyError`.
 */
export interface GenerationCase {
  lemma?: string;
  word?: string;
  feats: Record<string, string>;
  analyses?: Analysis[];
  error?: { type: string; message: string };
  referenceRaises?: string;
}

/** A parsed generation fixture (`generation/<component>.<list>.json.gz`). */
export interface GenerationFixture {
  file: string;
  component: 'generator' | 'reinflector';
  database: FixtureDatabase & { flags: string };
  requestList: { name: string; notice: string };
  cases: GenerationCase[];
}

/** Read one generation fixture by file name. */
export function readGenerationFixture(name: string): GenerationFixture {
  return { file: name, ...readGzJson<Omit<GenerationFixture, 'file'>>(`${GENERATION_DIR}/${name}`) };
}

/** Whether the Database_Pin is present under `data/`. */
export function databaseAvailable(): boolean {
  return existsSync(DB_PATH);
}

/** The Asset directory the replays load from (`SHANISARF_PARITY_ASSET`), or `null` to parse the pin. */
export const PARITY_ASSET: string | null =
  process.env['SHANISARF_PARITY_ASSET'] === undefined || process.env['SHANISARF_PARITY_ASSET'] === ''
    ? null
    : process.env['SHANISARF_PARITY_ASSET'];

/** Whether the replays can run: in Asset mode always (a missing Asset fails), else when the pin is present. */
export function replayAvailable(): boolean {
  return PARITY_ASSET !== null || databaseAvailable();
}

/** The suffix a replay's title carries in Asset mode, so a run says what it replayed over. */
export const REPLAY_MODE = PARITY_ASSET === null ? '' : ` (over the Asset at ${PARITY_ASSET})`;

const replayCache = new Map<'a' | 'r', Promise<{ db: MorphologyDb; sha256: string }>>();

/**
 * The model a replay runs over, once per worker and flags, with the database
 * identity its fixtures are checked against: the Database_Pin parsed with
 * `flags` and its SHA-256, or, in Asset mode, the Asset loaded with `flags`
 * and its Manifest's `sourceSha256`.
 */
export function replayDatabase(flags: 'a' | 'r'): Promise<{ db: MorphologyDb; sha256: string }> {
  let pending = replayCache.get(flags);
  if (pending === undefined) {
    pending =
      PARITY_ASSET === null
        ? Promise.resolve(flags === 'a' ? loadDatabase() : loadReinflectionDatabase())
        : loadAsset(PARITY_ASSET, { flags }).then((db) => ({ db, sha256: db.provenance?.sourceSha256 ?? '' }));
    replayCache.set(flags, pending);
  }
  return pending;
}

/** Read and gunzip a `*.json.gz` fixture into a parsed object. */
function readGzJson<T>(path: string): T {
  return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as T;
}

/** List the analyzer fixtures: every `*.json.gz` except the tokenizer one. */
export function listAnalyzerFixtures(): AnalyzerFixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.json.gz') && name !== 'word-tokenizer.json.gz')
    .sort()
    .map((name) => ({ file: name, ...readGzJson<Omit<AnalyzerFixture, 'file'>>(`${FIXTURES_DIR}/${name}`) }));
}

/** Read the single tokenizer fixture. */
export function readTokenizerFixture(): TokenizerFixture {
  const name = 'word-tokenizer.json.gz';
  return { file: name, ...readGzJson<Omit<TokenizerFixture, 'file'>>(`${FIXTURES_DIR}/${name}`) };
}

// The Database_Pin is parsed at most once per worker: the 85 MB text parse is
// expensive, and every fixture replays against the same model. The SHA-256 is
// computed once alongside it so each fixture can check its header against the
// file actually loaded (fail, not skip, on a SHA mismatch).
let dbCache: { db: MorphologyDb; sha256: string } | null = null;

/** Parse the Database_Pin once per worker and return it with its SHA-256. */
export function loadDatabase(): { db: MorphologyDb; sha256: string } {
  if (dbCache === null) {
    const bytes = readFileSync(DB_PATH);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const db = parseAlmor(bytes.toString('utf8'), { flags: 'a' });
    dbCache = { db, sha256 };
  }
  return dbCache;
}

// The `r` parse for the generation replays, also at
// most once per worker, kept apart from the `a` model the analyzer replay uses.
let reinflectionCache: { db: MorphologyDb; sha256: string } | null = null;

/** Parse the Database_Pin with `{ flags: 'r' }` once per worker, with its SHA-256. */
export function loadReinflectionDatabase(): { db: MorphologyDb; sha256: string } {
  if (reinflectionCache === null) {
    const bytes = readFileSync(DB_PATH);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    reinflectionCache = { db: parseAlmor(bytes.toString('utf8'), { flags: 'r' }), sha256 };
  }
  return reinflectionCache;
}

/**
 * Build an Analyzer from a fixture's header configuration.
 *
 * The header's `normMap` is `"default"` on every committed fixture, which the
 * Analyzer expresses as the `undefined` option (its default is
 * `DEFAULT_NORMALIZE_MAP`); a `null` header would mean
 * normalization off. `backoff` and `strictDigit` are passed through.
 */
export function analyzerFromHeader(db: MorphologyDb, cfg: FixtureAnalyzer): Analyzer {
  // `exactOptionalPropertyTypes` is on, so "the default map" is expressed by
  // omitting `normMap` rather than passing `undefined`; a `null` header
  // (normalization off) is passed explicitly.
  if (cfg.normMap === null) {
    return new Analyzer(db, { backoff: cfg.backoff, strictDigit: cfg.strictDigit, normMap: null });
  }
  return new Analyzer(db, { backoff: cfg.backoff, strictDigit: cfg.strictDigit });
}

// Host-side classification, for the knownDrift assertion. These
// regexes mirror the analyzer's private `IS_DIGIT`/`IS_STRICT_DIGIT`/
// `IS_PUNC`/`HAS_PUNC`/`IS_AR`, built from the same exported charset
// fragments, so the host path a word takes can be named without reaching into
// the analyzer's internals. The analyzer uses the host's `\p{P}`/`\p{S}`,
// which is exactly where Unicode_Drift between the host and CAMeL Tools
// shows up.
const IS_DIGIT = /^.*[0-9\u0660-\u0669]+.*$/u;
const IS_STRICT_DIGIT = /^[0-9\u0660-\u0669]+$/u;
const IS_PUNC = new RegExp(`^[${UNICODE_PUNCT_SYMBOL_CLASS}]+$`, 'u');
const HAS_PUNC = new RegExp(`[${UNICODE_PUNCT_SYMBOL_CLASS}]`, 'u');
const IS_AR = new RegExp(`^[${AR_CLASS}]+$`, 'u');

/** The path a word takes, as the host's Unicode data routes it. */
export type HostClass = 'digit' | 'punc' | 'has-punc' | 'foreign' | 'lexical';

/**
 * Classify a word by the host's Unicode data, in the analyzer's branch order
 * (digit, punc, has-punc, foreign, lexical), using the fixture's `strictDigit`
 * for the digit test. This is the host-side expectation a `knownDrift` entry's
 * `host` field is asserted against.
 */
export function hostClassify(word: string, strictDigit: boolean): HostClass {
  const stripped = pyStrip(word);
  const dediac = dediacAr(stripped);
  const digit = strictDigit ? IS_STRICT_DIGIT.test(dediac) : IS_DIGIT.test(dediac);
  if (digit) {
    return 'digit';
  }
  if (IS_PUNC.test(dediac)) {
    return 'punc';
  }
  if (HAS_PUNC.test(dediac)) {
    return 'has-punc';
  }
  if (!IS_AR.test(dediac)) {
    return 'foreign';
  }
  return 'lexical';
}

/**
 * Assert two canonically ordered analysis lists are equal: same length, and at
 * each index the same key set and the same values (numbers by `Object.is`,
 * strings and `null` by `===`). On any difference, throw with `label` (the
 * word and mode, or the request), the first differing index and both sides'
 * Canonical_Keys at that index. Shared by the
 * analyzer, generator and reinflector replays.
 */
export function assertAnalysesEqual(
  actual: CanonicalAnalysis[],
  expected: CanonicalAnalysis[],
  label: string,
): void {
  const n = Math.max(actual.length, expected.length);
  for (let i = 0; i < n; i++) {
    const a = actual[i];
    const e = expected[i];
    if (a === undefined || e === undefined || !analysisEquals(a, e)) {
      const where = `${label} firstDiff=${i}`;
      const actKey = a === undefined ? '<missing>' : canonicalKey(a);
      const expKey = e === undefined ? '<missing>' : canonicalKey(e);
      throw new Error(
        `parity mismatch: ${where}\n` +
          `  port lengths=${actual.length} reference lengths=${expected.length}\n` +
          `  port:      ${actKey}\n` +
          `  reference: ${expKey}`,
      );
    }
  }
  // Lengths equal is implied by the loop above having no undefined, but make
  // the invariant explicit for a clean failure if both lists are empty-equal
  // yet somehow differ in length.
  expect(actual.length).toBe(expected.length);
}

/**
 * Two analyses are equal when they have the same key set and, for every key,
 * the same value. Numbers compare by `Object.is` (so `-0`/`NaN` are handled
 * the way the serializer would see them), strings and `null` by `===`. This
 * is the per-index rule; a mismatch in
 * either direction (missing or extra key, or a differing value) fails.
 */
function analysisEquals(a: CanonicalAnalysis, b: CanonicalAnalysis): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return false;
    }
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'number' || typeof bv === 'number') {
      if (!Object.is(av, bv)) {
        return false;
      }
    } else if (av !== bv) {
      return false;
    }
  }
  return true;
}
