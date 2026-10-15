// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Backoff modes nest and mark, over the real Database_Pin: `NONE` is the
// lexical core every mode shares, `NOAN_*` adds backoff analyses only when the
// core is empty, `ADD_*` always appends them, `NOAN_PROP` is a subset of
// `NOAN_ALL`, and every backoff analysis carries CAMeL Tools' markers. Clauses
// are stated over `normMap(dediacAr(strip(word)))`, the string the analyzer
// segments. Words come from `arDbWord` and the `backoff-nonwords` and
// `edge-cases` Word_Lists. Skips with a loud notice when `data/` lacks the
// pin.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  Analyzer,
  type Analysis,
  type BackoffMode,
  type MorphologyDb,
  parseAlmor,
} from '../../src/engine/index.js';
import { dediacAr } from '../../src/engine/dediac.js';
import { DEFAULT_NORMALIZE_MAP } from '../../src/engine/index.js';
import { codePoints, pyStrip } from '../../src/engine/python-compat.js';

import { arDbWord } from './arbitraries';
import {
  type Analysis as CanonicalAnalysis,
  canonicalKey,
  canonicalOrder,
} from '../parity/canonical';

// ---------------------------------------------------------------------------
// Database_Pin location and the committed Word_Lists this property names.
// ---------------------------------------------------------------------------

/** Absolute path to the git-ignored Database_Pin under `data/`. */
const DB_PATH = fileURLToPath(
  new URL('../../data/camel-morph-msa/msa-v1.0.db', import.meta.url),
);

/** Absolute path to the committed `fixtures/wordlists/` directory. */
const WORDLISTS_DIR = fileURLToPath(
  new URL('../../fixtures/wordlists', import.meta.url),
);

/** The command the skip notice points developers at. */
const SETUP_HINT = 'npm run parity:setup';

/** The four backoff modes (every mode but `NONE`), paired with their action. */
const BACKOFF_MODES_WITH_ACTION: ReadonlyArray<{
  mode: BackoffMode;
  condition: 'NOAN' | 'ADD';
  action: 'ALL' | 'PROP';
}> = [
  { mode: 'NOAN_ALL', condition: 'NOAN', action: 'ALL' },
  { mode: 'NOAN_PROP', condition: 'NOAN', action: 'PROP' },
  { mode: 'ADD_ALL', condition: 'ADD', action: 'ALL' },
  { mode: 'ADD_PROP', condition: 'ADD', action: 'PROP' },
];

/**
 * Read a committed Word_List's words, skipping the `#` metadata header lines
 * and dropping the final empty segment a terminating newline leaves — the same
 * convention the generator's `_load_wordlist_words` uses (tools/parity/
 * generate.py), so the property iterates exactly the words the fixtures do.
 * A blank line is kept as the empty string (which `analyze` maps to `[]`).
 */
function loadWordlistWords(name: string): string[] {
  const raw = readFileSync(`${WORDLISTS_DIR}/${name}.words.txt`, 'utf8');
  // Split on '\n' only (newline translation is not wanted); drop a trailing
  // empty segment, then drop the `#` header/metadata lines.
  const lines = raw.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.filter((line) => !line.startsWith('#'));
}

// ---------------------------------------------------------------------------
// Analysis helpers (phrased over `source`, the field that tags each analysis).
// ---------------------------------------------------------------------------

/** A backoff analysis: produced by the backoff path (`source === 'backoff'`). */
function isBackoff(a: Analysis): boolean {
  return a['source'] === 'backoff';
}

/** A lexical analysis: produced by the lexical path (`source` `lex`/`spvar`). */
function isLexical(a: Analysis): boolean {
  return a['source'] === 'lex' || a['source'] === 'spvar';
}

/**
 * The non-backoff part of a result: everything the backoff path did not add.
 * On a special path (digit/punc/foreign) this is the single special-path
 * analysis; on the lexical/has-punc path it is the lexical analyses. The
 * backoff path only ever *appends* to this, never removes from it, so it is
 * the stable core the nest is built on.
 */
function nonBackoff(result: readonly Analysis[]): Analysis[] {
  return result.filter((a) => !isBackoff(a));
}

/** The Canonical_Key list of a result, for a multiset comparison. */
function keys(result: readonly Analysis[]): string[] {
  return canonicalOrder(result as CanonicalAnalysis[]).map((a) =>
    canonicalKey(a),
  );
}

/** The set of code-point slices of `word` (every contiguous substring). */
function codePointSlices(word: string): Set<string> {
  const cps = codePoints(word);
  const n = cps.length;
  const out = new Set<string>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j <= n; j++) {
      out.add(cps.slice(i, j).join(''));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The property.
// ---------------------------------------------------------------------------

const available = (() => {
  try {
    readFileSync(DB_PATH);
    return true;
  } catch {
    return false;
  }
})();

if (!available) {
  // Skip with a loud notice (never a silent pass), as the replay suite does:
  // the Database_Pin is CC BY 4.0 and git-ignored, so a fresh checkout lacks
  // it until `npm run parity:setup` fetches it.
  describe.skip('backoff modes nest and mark', () => {
    it(`is skipped: the Database_Pin is absent — run \`${SETUP_HINT}\``, () => {
      /* skipped — data/ lacks the Database_Pin */
    });
  });
} else {
  const db: MorphologyDb = parseAlmor(readFileSync(DB_PATH).toString('utf8'), {
    flags: 'a',
  });

  // One analyzer per mode, built once (each wraps the single parsed model).
  const analyzers = new Map<BackoffMode, Analyzer>();
  const allModes: BackoffMode[] = [
    'NONE',
    'NOAN_ALL',
    'NOAN_PROP',
    'ADD_ALL',
    'ADD_PROP',
  ];
  for (const mode of allModes) {
    analyzers.set(mode, new Analyzer(db, { backoff: mode }));
  }

  // The generator: the union of database-built words (`arDbWord`) and the two
  // committed Word_Lists this property names. `fc.oneof` draws from both arms;
  // the word-list arm is a `constantFrom` so its shrink walks to the first
  // listed word, and `arDbWord` shrinks to a short first-listed surface.
  const backoffNonwords = loadWordlistWords('backoff-nonwords');
  const edgeCases = loadWordlistWords('edge-cases');
  const wordArb: fc.Arbitrary<string> = fc.oneof(
    arDbWord(db),
    fc.constantFrom(...backoffNonwords),
    fc.constantFrom(...edgeCases),
  );

  describe('backoff modes nest and mark', () => {
    it(
      'backoff modes nest and mark',
      { timeout: 60_000 },
      () => {
        fc.assert(
          fc.property(wordArb, (word) => {
            // `wordNormal` is the string the analyzer segments: strip (Python
            // whitespace), dediacritize, then the default normalization map.
            // The backoff `lex` is a code-point segment of this string, so the
            // `lex` clause below is stated modulo dediac/normalization.
            const wordNormal = DEFAULT_NORMALIZE_MAP.mapString(
              dediacAr(pyStrip(word)),
            );
            const normalSlices = codePointSlices(wordNormal);

            const noneResult = (
              analyzers.get('NONE') as Analyzer
            ).analyze(word);
            const noneKeys = keys(noneResult);

            // `NONE` runs no backoff — it is pure lexical core.
            expect(noneResult.some(isBackoff)).toBe(false);

            // Has-punc classification: a word that contains punctuation/symbols
            // but is not all punctuation and is not a digit takes no lexical
            // lookup, so under `NONE` it has no analysis at all (checked in
            // full in the per-mode loop below).
            const noneHasLexical = noneResult.some(isLexical);

            for (const { mode, condition, action } of BACKOFF_MODES_WITH_ACTION) {
              const result = (analyzers.get(mode) as Analyzer).analyze(word);

              // Nesting: the non-backoff part of every mode's
              // result is exactly the `NONE` result, in Canonical_Order. The
              // backoff path only appends; it never drops or reorders the core.
              expect(keys(nonBackoff(result))).toEqual(noneKeys);

              const backoffAnalyses = result.filter(isBackoff);

              // The condition: under `NOAN_*`, backoff runs
              // only when the lexical core is empty; under `ADD_*`, it always
              // runs. (A special-path word — digit/punc/foreign — returns before
              // backoff in every mode, so its backoff set is empty; that is the
              // `noneResult` being the special-path analysis and backoff seeing
              // no segmentation to add to.)
              if (condition === 'NOAN') {
                if (noneResult.length > 0) {
                  // Non-empty core: `NOAN_*` is exactly the `NONE` result.
                  expect(keys(result)).toEqual(noneKeys);
                  expect(backoffAnalyses.length).toBe(0);
                }
                // Empty core: every analysis (if any) is a backoff analysis.
                // (Covered by the non-backoff === NONE check above: an empty
                // core forces the non-backoff part empty.)
              } else {
                // `ADD_*` nests: the result is the `NONE`
                // result followed by the backoff analyses — core first, in
                // enumeration order (lexical/special, then backoff).
                expect(result.slice(0, noneResult.length)).toEqual(noneResult);
                expect(result.slice(noneResult.length).every(isBackoff)).toBe(
                  true,
                );
              }

              // Every backoff analysis carries CAMeL Tools' markers.
              for (const b of backoffAnalyses) {
                // `source` and `pattern` are the backoff tags.
                expect(b['source']).toBe('backoff');
                expect(b['pattern']).toBe('backoff');
                // `cm_stem` stays `NOAN`: only `bw`/`diac`/`lex` are substituted
                // so the `NOAN` stem's `cm_stem` survives.
                expect(b['cm_stem']).toBe('NOAN');
                // `stemcat` is one of the action's backoff categories
                // (selected by action).
                const backoffCats = db.stemBackoffs.get(action) ?? [];
                expect(backoffCats).toContain(b['stemcat']);
                // `lex` is the normalized stem segment: the `NOAN` lex with the
                // segment substituted in, so it is a code-point slice of
                // `wordNormal` (modulo normalization).
                expect(normalSlices.has(b['lex'] as string)).toBe(true);

                // `*_PROP`: a proper-noun backoff only. Every
                // backoff `bw` contains `NOUN_PROP` and `stemcat` is the single
                // `PROP` category `X00298`.
                if (action === 'PROP') {
                  expect((b['bw'] as string).includes('NOUN_PROP')).toBe(true);
                  expect(b['stemcat']).toBe('X00298');
                }
              }
            }

            // `NOAN_PROP` ⊆ `NOAN_ALL`: the proper-noun
            // backoff set is a subset of the all-category backoff set, as a
            // multiset of Canonical_Keys.
            const propBackoffKeys = keys(
              (analyzers.get('ADD_PROP') as Analyzer)
                .analyze(word)
                .filter(isBackoff),
            );
            const allBackoffKeys = keys(
              (analyzers.get('ADD_ALL') as Analyzer)
                .analyze(word)
                .filter(isBackoff),
            );
            // Every PROP backoff key (with multiplicity) occurs in the ALL set.
            const allCounts = new Map<string, number>();
            for (const k of allBackoffKeys) {
              allCounts.set(k, (allCounts.get(k) ?? 0) + 1);
            }
            for (const k of propBackoffKeys) {
              const n = allCounts.get(k) ?? 0;
              expect(n).toBeGreaterThan(0);
              allCounts.set(k, n - 1);
            }

            // Has-punc: a word with punctuation that is not
            // all punctuation and not a digit yields no lexical analysis in any
            // mode, and backoff analyses in the four backoff modes. We detect
            // the class structurally: `NONE` produced neither a lexical nor a
            // special-path analysis (an empty core) yet a backoff mode produced
            // backoff analyses — exactly the has-punc fall-through.
            if (!noneHasLexical && noneResult.length === 0) {
              // In every backoff mode the result has no lexical analysis.
              for (const { mode } of BACKOFF_MODES_WITH_ACTION) {
                const result = (analyzers.get(mode) as Analyzer).analyze(word);
                expect(result.some(isLexical)).toBe(false);
              }
            }
          }),
          { numRuns: 40 },
        );
      },
    );
  });
}
