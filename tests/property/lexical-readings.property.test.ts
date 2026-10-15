// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Lexical analyses are readings of the word, over the real Database_Pin. For
// any `arDbWord` or `arNormVariant` of one, every analysis under `NONE` has a
// `diac` whose dediacritized, normalized form is the word's; a non-empty
// `stem` that is a stem surface; a `stemcat` of one of that surface's entries;
// `prc*`/`enc*` values in the defines; and `source === 'spvar'` exactly when
// `dediacAr(diac)` differs from the word's. (`d3tok` is not re-derived: its
// letter-level rewrites are pinned by the parity replay instead.) The diac and
// stem clauses are stated modulo the ASCII underscore on the analysis side:
// 19 proper-noun stems of the pin carry `_` in their `diac` (`قيهم` →
// `قيهم__`), which CAMeL Tools returns verbatim and marks `spvar`; a second
// test sweeps those stems so the quirk is exercised on every run. Skips with a
// notice when `data/` lacks the pin.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  Analyzer,
  DEFAULT_NORMALIZE_MAP,
  parseAlmor,
  type Analysis,
  type MorphologyDb,
} from '../../src/engine/index.js';
import { dediacAr } from '../../src/engine/dediac.js';
import { pyStrip } from '../../src/engine/python-compat.js';
import { arDbWord, arNormVariant } from './arbitraries.js';

// 20–50 runs with a 60 s per-test budget; each run analyzes
// a real-database word, so the pool is kept small and the timeout explicit.
const NUM_RUNS = 30;
const PROPERTY_OPTIONS = { numRuns: NUM_RUNS, timeout: 60_000 } as const;

/** Absolute path to the git-ignored Database_Pin under `data/`. */
const DB_PATH = fileURLToPath(
  new URL('../../data/camel-morph-msa/msa-v1.0.db', import.meta.url),
);

/** The command the skip notice points developers at. */
const SETUP_HINT = 'npm run parity:setup';

/** The ASCII underscore, U+005F, that 19 Database_Pin stem diacs carry. */
const UNDERSCORE = '_';

/** The default normalization map, applied as the analyzer applies it. */
function normMap(s: string): string {
  return DEFAULT_NORMALIZE_MAP.mapString(s);
}

/** `normMap(dediacAr(s))`: strip diacritics then fold normalization variants. */
function normalizedDediac(s: string): string {
  return normMap(dediacAr(s));
}

/**
 * The letters an analysis-side form (`diac`, `stem`) reads as:
 * {@link normalizedDediac} with every ASCII underscore removed (file header,
 * the underscore quirk). Applied to analysis values only, never to the word,
 * which contains no underscore; so for every analysis but the 19 quirky
 * stems' this is exactly `normalizedDediac`.
 */
function analysisReading(s: string): string {
  return normalizedDediac(s).split(UNDERSCORE).join('');
}

// The Database_Pin is parsed at most once per worker: the 85 MB text parse is
// expensive and every case analyzes against the same model.
let dbCache: MorphologyDb | null = null;

/** Parse the Database_Pin once per worker. */
function loadDatabase(): MorphologyDb {
  if (dbCache === null) {
    dbCache = parseAlmor(readFileSync(DB_PATH, 'utf8'), { flags: 'a' });
  }
  return dbCache;
}

/**
 * The feature keys whose values the defines constrain to a closed list, as
 * clause (e) reads them: every `prc*`/`enc*` key the database defines with a
 * non-null (closed-class) value list. An open-class define (`null` value list)
 * admits any value, so it is not asserted.
 */
function closedProcliticEncliticLists(
  db: MorphologyDb,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [name, values] of db.defines) {
    if (
      values !== null &&
      (name.startsWith('prc') || name.startsWith('enc'))
    ) {
      out.set(name, new Set(values));
    }
  }
  return out;
}

/**
 * The stem surfaces with an entry whose `diac` carries an ASCII underscore:
 * the 19 quirky lines of the Database_Pin (file header). Read from the parsed
 * database rather than listed here, so an upstream sync that adds, fixes or
 * drops such lines changes what the sweep covers without a hand edit.
 */
function underscoreDiacSurfaces(db: MorphologyDb): string[] {
  const out: string[] = [];
  for (const [surface, entries] of db.stems) {
    if (entries.some((e) => (e.features['diac'] ?? '').includes(UNDERSCORE))) {
      out.push(surface);
    }
  }
  return out;
}

const describeOrSkip = existsSync(DB_PATH) ? describe : describe.skip;

if (!existsSync(DB_PATH)) {
  console.warn(
    `lexical-readings property skipped: the Database_Pin is not under data/. Run \`${SETUP_HINT}\` to fetch it.`,
  );
}

describeOrSkip('lexical analyses are readings of the word', () => {
  const db = loadDatabase();
  // The default map, `NONE` backoff: only `lex`/`spvar` analyses are produced,
  // so every analysis the property body sees is a lexical reading.
  const analyzer = new Analyzer(db, { backoff: 'NONE' });
  const closedLists = closedProcliticEncliticLists(db);

  // Both arbitraries produce a word that has lexical analyses: `arDbWord`
  // builds a stem surface with compatible affixes, and `arNormVariant` carries
  // a deliberate normalization variant so the normalize-then-analyze path and
  // the `spvar` rule are exercised. A plain `arDbWord` is included so the
  // non-variant case is covered too.
  const word = fc.oneof(arDbWord(db), arNormVariant);

  /**
   * Assert clauses (a) and (c)–(f) for every `lex`/`spvar` analysis of `w`,
   * and return the analyses so a caller can assert what they contained. The
   * property body and the underscore sweep share this so both hold the same
   * reading relation.
   */
  function expectLexicalReadings(w: string): Analysis[] {
    const analyses: Analysis[] = analyzer.analyze(w);

    // The reference for every clause. The analyzer strips (Python semantics),
    // dediacritizes, then normalizes before lookup, and the spvar rule
    // compares the stripped-dediac-with-tatweel-removed form against
    // `dediacAr(diac)` (not the normalized form). Mirror both: `wordNorm` is
    // the normalized dediac the diac/stem clauses recover to;
    // `wordDediacNoTatweel` is the exact string the engine's spvar rule
    // compares, so clause (f) is checked against the engine's own comparison
    // rather than an approximation.
    const stripped = pyStrip(w);
    const wordNorm = normMap(dediacAr(stripped));
    const wordDediacNoTatweel = dediacAr(stripped).replace(/\u0640/gu, '');

    for (const analysis of analyses) {
      const source = analysis['source'];
      // Only lexical readings are in scope; under NONE there is nothing else,
      // but the guard keeps the property honest if the arbitrary ever yields
      // a special-path word.
      if (source !== 'lex' && source !== 'spvar') {
        continue;
      }

      const diac = analysis['diac'];
      expect(typeof diac).toBe('string');
      const diacStr = diac as string;

      // (a) The diacritized form is the word, modulo dediac + normMap, with
      // the quirky stems' underscores removed (file header).
      expect(analysisReading(diacStr)).toBe(wordNorm);

      // (Clause (b), d3tok letter reconstruction, is intentionally not
      // asserted here — see the file header. The d3 scheme's letter-level
      // rewrites are not a stable insertion-only / subsequence relation, and
      // d3tok's exact value is pinned by the parity replay suite.)

      // (c) stem is non-empty and its dediac, normalized and with the quirky
      // stems' underscores removed, is a stem surface key.
      const stem = analysis['stem'];
      expect(typeof stem).toBe('string');
      const stemStr = stem as string;
      expect(stemStr.length).toBeGreaterThan(0);
      const stemSurface = analysisReading(stemStr);
      expect(db.stems.has(stemSurface)).toBe(true);

      // (d) stemcat is the category of one of that surface's entries.
      const stemEntries = db.stems.get(stemSurface);
      expect(stemEntries).toBeDefined();
      const stemcat = analysis['stemcat'];
      expect((stemEntries ?? []).some((e) => e.category === stemcat)).toBe(
        true,
      );

      // (e) every closed-class prc*/enc* value is in its defines list.
      for (const [key, legal] of closedLists) {
        const value = analysis[key];
        if (typeof value === 'string') {
          expect(legal.has(value)).toBe(true);
        }
      }

      // (f) source is 'spvar' exactly when the tatweel-stripped dediac of the
      // word differs from the dediac of the diacritized form. Underscores are
      // kept on both sides, as the engine's rule keeps them: a quirky stem's
      // analysis must therefore be `spvar`, as CAMeL Tools marks it.
      const isSpvar = source === 'spvar';
      const differs = wordDediacNoTatweel !== dediacAr(diacStr);
      expect(isSpvar).toBe(differs);
    }
    // A word with no lexical analysis vacuously satisfies the property.
    return analyses;
  }

  it('every lex/spvar analysis is a reading of the word modulo dediac and the normalization map', () => {
    fc.assert(
      fc.property(word, (w) => {
        expectLexicalReadings(w);
      }),
      PROPERTY_OPTIONS,
    );
  });

  // The deterministic complement to the property for the underscore quirk
  // (file header): every stem surface with an underscore-bearing `diac`, as
  // its own word, satisfies the clauses, and the engine returns the stem's
  // `diac` verbatim, underscores included, as CAMeL Tools does. Removing
  // them in the engine would be an output change, and would fail here.
  it('every underscore-diac stem surface is a reading modulo the underscores, which the engine returns', () => {
    const surfaces = underscoreDiacSurfaces(db);
    // The Database_Pin has 19. A pin with none makes the restatement moot:
    // that is the signal to drop this sweep and the underscore removal with it.
    expect(surfaces.length).toBeGreaterThan(0);
    for (const surface of surfaces) {
      const analyses = expectLexicalReadings(surface);
      expect(
        analyses.some(
          (a) => typeof a['diac'] === 'string' && a['diac'].includes(UNDERSCORE),
        ),
      ).toBe(true);
    }
  });
});
