// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Determinism, cache transparency and batch, over the real Database_Pin. For
// any list of words with repeats: `analyze(word)` called twice, and across
// analyzers, yields the same analyses in the same order; an analyzer with
// `cacheSize` in {0, 1, 3, 100} returns exactly what a fresh `cacheSize 0`
// analyzer returns (the cache changes speed, never output); and
// `analyzeWords(words)` equals mapping `analyze` over the words, in order.
// Order against CAMeL Tools is the parity replay's job; here it is checked
// relationally. Skips with a loud notice when `data/` lacks the pin.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  Analyzer,
  type Analysis,
  type BackoffMode,
  type MorphologyDb,
  parseAlmor,
} from '../../src/engine/index.js';
import { canonicalKey, canonicalOrder } from '../parity/canonical';

// ---------------------------------------------------------------------------
// Database_Pin loading and skip-with-notice (as replay-support.ts does).
// ---------------------------------------------------------------------------

/** Absolute path to the git-ignored Database_Pin under `data/`. */
const DB_PATH = fileURLToPath(
  new URL('../../data/camel-morph-msa/msa-v1.0.db', import.meta.url),
);

/** The command the skip notice points developers at. */
const SETUP_HINT = 'npm run parity:setup';

/** Directory holding the committed, reviewed Word_Lists. */
const WORDLISTS_DIR = fileURLToPath(
  new URL('../../fixtures/wordlists', import.meta.url),
);

/** Whether the Database_Pin is present under `data/`. */
function databaseAvailable(): boolean {
  try {
    readFileSync(DB_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a committed Word_List into its words. Metadata lines (those beginning
 * with `#`) are dropped; every other line is kept verbatim as a word, minus
 * the line terminator — including the blank and whitespace-only lines the
 * `edge-cases` list carries deliberately (an empty string and single
 * Python_Whitespace code points are legal inputs the analyzer must handle).
 * A trailing newline would leave one empty segment at the end, which `pyLines`
 * drops; this reader mirrors that by splitting on `\n` and discarding a single
 * final empty segment so the word count matches the lines a human reviews.
 */
function readWordList(name: string): string[] {
  const text = readFileSync(`${WORDLISTS_DIR}/${name}.words.txt`, 'utf8');
  // Normalize CRLF/CR to LF (universal newlines, as pyLines treats them),
  // then split and drop a single trailing empty segment from a final newline.
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.filter((line) => !line.startsWith('#'));
}

// ---------------------------------------------------------------------------
// Equality: an analysis list compared by Canonical_Key, element by element.
// ---------------------------------------------------------------------------

/**
 * Whether two analysis lists are equal as ordered sequences: same length and,
 * at every index, the same Canonical_Key. The Canonical_Key is the exact
 * identity the parity suite compares by, so two results are
 * "equal" here precisely when the parity suite would call them equal — same
 * keys, same values, same order. Order is preserved (no `canonicalOrder`
 * sort): this property is about the sequence `analyze` returns being stable
 * across cache sizes and batching, which includes the index order, so a
 * reordering is a difference, not something the comparison should wash out.
 */
function sameSequence(a: readonly Analysis[], b: readonly Analysis[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (canonicalKey(a[i] as Analysis) !== canonicalKey(b[i] as Analysis)) {
      return false;
    }
  }
  return true;
}

/** A compact description of the first difference, for a readable failure. */
function describeFirstDiff(
  a: readonly Analysis[],
  b: readonly Analysis[],
): string {
  if (a.length !== b.length) {
    return `lengths differ: ${a.length} vs ${b.length}`;
  }
  for (let i = 0; i < a.length; i++) {
    const ka = canonicalKey(a[i] as Analysis);
    const kb = canonicalKey(b[i] as Analysis);
    if (ka !== kb) {
      return `index ${i} differs:\n    a: ${ka}\n    b: ${kb}`;
    }
  }
  return 'no difference';
}

// ---------------------------------------------------------------------------
// The property.
// ---------------------------------------------------------------------------

const available = databaseAvailable();

if (!available) {
  // Skip with a loud notice, not a silent pass, so a developer sees how to
  // make the property run (as the parity replay suite does).
  describe.skip('determinism, cache transparency and batch', () => {
    it(`is skipped: the Database_Pin is absent — run \`${SETUP_HINT}\``, () => {
      /* skipped — data/ lacks the Database_Pin */
    });
  });
} else {
  // Parse the Database_Pin once for the whole suite: the 85 MB text parse is
  // expensive and every run of the property replays against the same model.
  const bytes = readFileSync(DB_PATH);
  const db: MorphologyDb = parseAlmor(bytes.toString('utf8'), { flags: 'a' });

  // The committed Word_Lists, pooled. The property is "for any list of words
  // (with repeats)"; the word pool is the union of the three reviewed lists,
  // which between them cover database forms, backoff non-words and every edge
  // case (digits, punctuation, foreign, whitespace, empty, astral). The
  // arbitrary draws a list with repeats from this pool so a counterexample is
  // a short, real list of in-corpus words.
  const WORD_POOL: readonly string[] = [
    ...readWordList('edge-cases'),
    ...readWordList('backoff-nonwords'),
    ...readWordList('db-forms'),
  ];

  // The cache sizes the property quantifies over.
  const CACHE_SIZES = [0, 1, 3, 100] as const;

  // A backoff mode drawn alongside the list, so the property exercises the
  // lexical, special and backoff paths under caching, not just NONE. All five
  // modes are deterministic, so transparency and batch must hold under each.
  const BACKOFF_MODES_ARB: fc.Arbitrary<BackoffMode> = fc.constantFrom(
    'NONE',
    'NOAN_ALL',
    'NOAN_PROP',
    'ADD_ALL',
    'ADD_PROP',
  );

  // A word list with repeats: a short array drawn from the pool, with a second
  // pass that duplicates some entries so repeats are guaranteed (a cache only
  // earns its keep on a repeated key, and transparency is most at risk there).
  // Built from small pieces: 1..12 words, each an index into the
  // pool, so a shrunk counterexample is a short list of the first-listed,
  // simplest words.
  const wordListArb: fc.Arbitrary<string[]> = fc
    .array(fc.integer({ min: 0, max: WORD_POOL.length - 1 }), {
      minLength: 1,
      maxLength: 12,
    })
    .chain((indices) =>
      // Append a repeat of a prefix of the drawn indices so the list always
      // contains at least one repeated word (when it has more than one entry).
      fc.nat({ max: indices.length }).map((repeatCount) => {
        const words = indices.map((i) => WORD_POOL[i] as string);
        const repeats = words.slice(0, repeatCount);
        return [...words, ...repeats];
      }),
    );

  describe('determinism, cache transparency and batch', () => {
    it('has a non-empty word pool from the committed lists', () => {
      expect(WORD_POOL.length).toBeGreaterThan(0);
    });

    it(
      'a cached analyzer matches a fresh cacheSize 0 analyzer, calls are deterministic, and analyzeWords equals mapping analyze',
      { timeout: 60_000 },
      () => {
        fc.assert(
          fc.property(
            wordListArb,
            BACKOFF_MODES_ARB,
            fc.constantFrom(...CACHE_SIZES),
            (words, backoff, cacheSize) => {
              // The reference analyzer for this property: a fresh, uncached
              // (`cacheSize 0`) analyzer under the drawn backoff mode. Its
              // per-word output is the ground truth the cached analyzer and the
              // batch call are checked against.
              const uncached = new Analyzer(db, { backoff, cacheSize: 0 });

              // Determinism (one analyzer): analyze every word twice through
              // the uncached analyzer; the two calls must return equal
              // sequences. This isolates a nondeterministic enumeration bug
              // from the cache.
              const baseline = words.map((w) => uncached.analyze(w));
              words.forEach((w, i) => {
                const again = uncached.analyze(w);
                expect(
                  sameSequence(again, baseline[i] as Analysis[]),
                  `determinism: repeated analyze(${JSON.stringify(w)}) differs\n  ${describeFirstDiff(again, baseline[i] as Analysis[])}`,
                ).toBe(true);
              });

              // Cache transparency: a fresh analyzer at the drawn cacheSize
              // must return, for every word in the (repeat-bearing) list, the
              // same sequence the uncached analyzer returned. Walk the list in
              // order so the cache fills and is hit on the repeats, which is
              // exactly where a non-transparent cache would show.
              const cached = new Analyzer(db, { backoff, cacheSize });
              words.forEach((w, i) => {
                const got = cached.analyze(w);
                expect(
                  sameSequence(got, baseline[i] as Analysis[]),
                  `cache transparency (cacheSize=${cacheSize}, backoff=${backoff}): analyze(${JSON.stringify(w)}) at #${i} differs from cacheSize 0\n  ${describeFirstDiff(got, baseline[i] as Analysis[])}`,
                ).toBe(true);
              });

              // Batch: analyzeWords is one { word, analyses } pair per input,
              // in order, each equal to analyze of the same word. Run it on a
              // fresh cached analyzer so batching under a cache is covered too.
              const batchAnalyzer = new Analyzer(db, { backoff, cacheSize });
              const batch = batchAnalyzer.analyzeWords(words);
              expect(
                batch.length,
                `batch: analyzeWords returned ${batch.length} pairs for ${words.length} words`,
              ).toBe(words.length);
              batch.forEach((pair, i) => {
                expect(
                  pair.word,
                  `batch: pair #${i} word mismatch`,
                ).toBe(words[i]);
                expect(
                  sameSequence(pair.analyses, baseline[i] as Analysis[]),
                  `batch: analyzeWords pair #${i} (${JSON.stringify(words[i])}) differs from analyze\n  ${describeFirstDiff(pair.analyses, baseline[i] as Analysis[])}`,
                ).toBe(true);
              });

              // Order claim, relationally: canonicalOrder is a stable function
              // of the result, so a reordering within a single result is
              // already caught by sameSequence above (which compares index by
              // index without sorting). As a cross-check, the sorted form must
              // also agree — this guards against a cache that returned a
              // different multiset that happened to share an index-wise prefix.
              words.forEach((w, i) => {
                const got = cached.analyze(w);
                expect(
                  sameSequence(
                    canonicalOrder(got),
                    canonicalOrder(baseline[i] as Analysis[]),
                  ),
                  `order (sorted multiset) for ${JSON.stringify(w)} differs under cacheSize=${cacheSize}`,
                ).toBe(true);
              });
            },
          ),
          { numRuns: 30 },
        );
      },
    );
  });
}
