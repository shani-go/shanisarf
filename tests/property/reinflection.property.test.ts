// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Reinflection is filtered analysis, then generation, over the Database_Pin
// parsed with `r`. For a `db-forms` word and one of the ten bundles of
// `reinflect-requests` on which the port does not throw: no two results have
// equal ordered entries; every result's `lex` is the stripped `lex` of an
// analysis whose `diac` dediacritizes to the word; and every requested key not
// 'ANY' that the result carries has the requested value, except a
// CLITIC_IGNORED_FEATS key requested with a clitic (CAMeL Tools drops it).
// `reinflect(' ' + word, feats)` and an unanalyzable word return []. Skips
// with the replay notice when `data/` lacks the pin.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  Analyzer,
  dediacAr,
  Reinflector,
} from '../../src/engine/index.js';
import { stripLex } from '../../src/engine/features.js';
import { CLITIC_FEATS, CLITIC_IGNORED_FEATS } from '../../src/engine/reinflector.js';
import {
  databaseAvailable,
  loadReinflectionDatabase,
  SETUP_HINT,
} from '../parity/replay-support';

import { arAr } from './arbitraries';
import { loadWordlistWords } from './wordlists';

/** The ten bundles of `reinflect-requests`. */
const BUNDLES: Record<string, string>[] = [
  { num: 'p' },
  { gen: 'f' },
  { per: '1' },
  { asp: 'i' },
  { stt: 'd' },
  { cas: 'a' },
  { enc0: '3ms_poss' },
  { prc0: 'Al_det' },
  { num: 'ANY' },
  { rat: 'y' },
];

type Clause =
  | { kind: 'word'; word: string; feats: Record<string, string> }
  | { kind: 'padded'; word: string; feats: Record<string, string> }
  | { kind: 'unanalyzable'; word: string; feats: Record<string, string> };

if (!databaseAvailable()) {
  describe.skip('reinflection', () => {
    it(`is skipped: the Database_Pin is absent — run \`${SETUP_HINT}\``, () => {
      /* skipped — data/ lacks the Database_Pin */
    });
  });
} else {
  const { db } = loadReinflectionDatabase();
  const reinflector = new Reinflector(db);
  const analyzer = new Analyzer(db);
  const dbForms = loadWordlistWords('db-forms');

  const wordArb = fc.constantFrom(...dbForms);
  const bundleArb = fc.constantFrom(...BUNDLES);
  const anyFeatsArb = fc.dictionary(
    fc.constantFrom('num', 'gen', 'xyz', 'rat'),
    fc.constantFrom('p', 'f', 'ANY', 'invalid'),
    { maxKeys: 2 },
  );

  const clauseArb: fc.Arbitrary<Clause> = fc.oneof(
    { weight: 6, arbitrary: fc.tuple(wordArb, bundleArb).map(([word, feats]): Clause => ({ kind: 'word', word, feats })) },
    { weight: 1, arbitrary: fc.tuple(wordArb, bundleArb).map(([word, feats]): Clause => ({ kind: 'padded', word, feats })) },
    {
      weight: 1,
      arbitrary: fc
        .tuple(arAr, anyFeatsArb)
        .filter(([word]) => analyzer.analyze(word).length === 0)
        .map(([word, feats]): Clause => ({ kind: 'unanalyzable', word, feats })),
    },
  );

  describe('reinflection', () => {
    it('reinflection is filtered analysis, then generation', { timeout: 60_000 }, () => {
      fc.assert(
        fc.property(clauseArb, (clause) => {
          if (clause.kind === 'padded') {
            expect(reinflector.reinflect(` ${clause.word}`, clause.feats)).toEqual([]);
            return;
          }
          if (clause.kind === 'unanalyzable') {
            expect(reinflector.reinflect(clause.word, clause.feats)).toEqual([]);
            return;
          }

          const { word, feats } = clause;
          let results;
          try {
            results = reinflector.reinflect(word, feats);
          } catch {
            return; // the property covers the requests on which the port does not throw
          }

          // No two results with equal ordered entries.
          const keys = results.map((r) => JSON.stringify(Object.entries(r)));
          expect(new Set(keys).size).toBe(keys.length);

          // Every lex is the stripped lex of a matching analysis of the word.
          const wordDediac = dediacAr(word);
          const lemmas = new Set(
            analyzer
              .analyze(word)
              .filter((a) => typeof a['diac'] === 'string' && dediacAr(a['diac']) === wordDediac)
              .map((a) => stripLex(a['lex'] as string)),
          );
          for (const r of results) {
            expect(lemmas.has(r['lex'] as string), `${word}: lex ${String(r['lex'])}`).toBe(true);
          }

          // Requested values hold where the result carries the key.
          const hasClitic = Object.keys(feats).some((k) => CLITIC_FEATS.has(k));
          for (const [key, value] of Object.entries(feats)) {
            if (value === 'ANY' || (hasClitic && CLITIC_IGNORED_FEATS.has(key))) {
              continue;
            }
            for (const r of results) {
              if (Object.prototype.hasOwnProperty.call(r, key)) {
                expect(r[key], `${word} ${JSON.stringify(feats)}: ${key}`).toBe(value);
              }
            }
          }
        }),
        { numRuns: 40 },
      );
    });
  });
}
