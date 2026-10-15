// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Generated forms analyze back exactly, over the Database_Pin parsed with `r`.
// For a sampled lemma and a request of its first stem's `pos`, alone or with
// one feature of that `pos`'s `DEFAULTS` row, every generated analysis carries
// the lemma as its `lex` and every requested key with the requested value, has
// the `stemcat` of one of the lemma's stems, and is returned, with the same
// Canonical_Key, by an Analyzer given its dediacritized `diac` (true on CAMeL
// Tools for 11,284 of 11,284); two calls return equal lists. Skips with the
// replay notice when `data/` lacks the pin.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { Analyzer, dediacAr, Generator } from '../../src/engine/index.js';
import { stripLex } from '../../src/engine/features.js';
import { canonicalKey } from '../parity/canonical';
import {
  databaseAvailable,
  loadReinflectionDatabase,
  SETUP_HINT,
} from '../parity/replay-support';

if (!databaseAvailable()) {
  describe.skip('generation round trip', () => {
    it(`is skipped: the Database_Pin is absent — run \`${SETUP_HINT}\``, () => {
      /* skipped — data/ lacks the Database_Pin */
    });
  });
} else {
  const { db } = loadReinflectionDatabase();
  const generator = new Generator(db);
  const analyzer = new Analyzer(db);
  // `NOAN` is the backoff placeholder, not a lemma: its forms are Latin
  // script, which the Analyzer sends down the foreign path, so they cannot
  // analyze back. The CAMeL Tools measurement sampled real lemmas only.
  const lemmas = [...db.lemmaHash.keys()].filter((lemma) => lemma !== 'NOAN');

  /** A lemma by index, and a request: its first stem's pos, maybe one more feature. */
  const requestArb = fc
    .integer({ min: 0, max: lemmas.length - 1 })
    .chain((index) => {
      const lemma = lemmas[index] as string;
      const pos = (db.lemmaHash.get(lemma)?.[0]?.features['pos']) as string;
      const row = db.defaults.get(pos) ?? {};
      const extra = Object.keys(row).filter(
        (key) => key !== 'pos' && (db.defines.get(key)?.length ?? 0) > 0,
      );
      const plain = fc.constant({ lemma, feats: { pos } as Record<string, string> });
      if (extra.length === 0) {
        return plain;
      }
      const withFeature = fc
        .constantFrom(...extra)
        .chain((key) =>
          fc.constantFrom(...(db.defines.get(key) as string[])).map((value) => ({
            lemma,
            feats: { pos, [key]: value } as Record<string, string>,
          })),
        );
      return fc.oneof(plain, withFeature);
    });

  describe('generation round trip', () => {
    it('generated forms analyze back exactly', { timeout: 60_000 }, () => {
      fc.assert(
        fc.property(requestArb, ({ lemma, feats }) => {
          const results = generator.generate(lemma, feats);
          const stemCats = new Set((db.lemmaHash.get(lemma) ?? []).map((e) => e.category));

          for (const g of results) {
            expect(g['lex']).toBe(stripLex(lemma));
            for (const [key, value] of Object.entries(feats)) {
              if (Object.prototype.hasOwnProperty.call(g, key)) {
                expect(g[key], key).toBe(value);
              }
            }
            expect(stemCats.has(g['stemcat'] as string)).toBe(true);
            const key = canonicalKey(g);
            const back = analyzer.analyze(dediacAr(g['diac'] as string)).map((a) => canonicalKey(a));
            expect(back, `${g['diac'] as string} analyzes back`).toContain(key);
          }

          expect(generator.generate(lemma, feats)).toEqual(results);
        }),
        { numRuns: 30 },
      );
    });
  });
}
