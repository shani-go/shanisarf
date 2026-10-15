// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Analysis does not depend on the flags. Over the real Database_Pin, an
// Analyzer over the pin parsed with `r` returns, for `arDbWord` and
// `edge-cases` words under all five backoff modes, analyses index-equal (same
// order, same keys in the same order, same values) to one over the pin parsed
// with `a`. The `r` model round-trips through `serializeAlmor` with its
// generation tables, and a `g`-only model is refused with `DatabaseError`.
// Skips with the replay suite's notice when `data/` lacks the pin.

import { readFileSync } from 'node:fs';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  Analyzer,
  BACKOFF_MODES,
  type BackoffMode,
  DatabaseError,
  type MorphologyDb,
  parseAlmor,
  serializeAlmor,
} from '../../src/engine/index.js';
import { databaseAvailable, DB_PATH, SETUP_HINT } from '../parity/replay-support';

import { arDbWord } from './arbitraries';
import { loadWordlistWords } from './wordlists';

if (!databaseAvailable()) {
  describe.skip('analysis flags', () => {
    it(`is skipped: the Database_Pin is absent — run \`${SETUP_HINT}\``, () => {
      /* skipped — data/ lacks the Database_Pin */
    });
  });
} else {
  const text = readFileSync(DB_PATH, 'utf8');
  const dbA: MorphologyDb = parseAlmor(text, { flags: 'a' });
  const dbR: MorphologyDb = parseAlmor(text, { flags: 'r' });

  const modes = [...BACKOFF_MODES] as BackoffMode[];
  const pairs = modes.map((mode) => ({
    mode,
    a: new Analyzer(dbA, { backoff: mode, cacheSize: 0 }),
    r: new Analyzer(dbR, { backoff: mode, cacheSize: 0 }),
  }));

  const wordArb = fc.oneof(arDbWord(dbA), fc.constantFrom(...loadWordlistWords('edge-cases')));

  describe('analysis flags', () => {
    it('analysis does not depend on the flags', { timeout: 60_000 }, () => {
      fc.assert(
        fc.property(wordArb, (word) => {
          for (const { a, r } of pairs) {
            // Index-equal, key order included: the port never writes a key
            // into a shared stem record.
            const expected = a.analyze(word).map((x) => JSON.stringify(x));
            const actual = r.analyze(word).map((x) => JSON.stringify(x));
            expect(actual).toEqual(expected);
          }
        }),
        { numRuns: 30 },
      );
    });

    it('an r model round-trips through serializeAlmor and a g-only model is refused', { timeout: 60_000 }, () => {
      const again = parseAlmor(serializeAlmor(dbR), { flags: 'r' });
      expect(again.flags).toEqual(dbR.flags);
      expect(again.defaults).toEqual(dbR.defaults);
      expect(again.order).toEqual(dbR.order);
      expect(again.stemBackoffs).toEqual(dbR.stemBackoffs);
      expect(again.prefixes).toEqual(dbR.prefixes);
      expect(again.suffixes).toEqual(dbR.suffixes);
      expect(again.stems).toEqual(dbR.stems);
      expect(again.prefixStemCompat).toEqual(dbR.prefixStemCompat);
      expect(again.stemSuffixCompat).toEqual(dbR.stemSuffixCompat);
      expect(again.prefixSuffixCompat).toEqual(dbR.prefixSuffixCompat);
      expect(again.prefixCatHash).toEqual(dbR.prefixCatHash);
      expect(again.suffixCatHash).toEqual(dbR.suffixCatHash);
      expect(again.lemmaHash).toEqual(dbR.lemmaHash);
      expect(again.stemPrefixCompat).toEqual(dbR.stemPrefixCompat);

      const dbG = parseAlmor(text, { flags: 'g' });
      expect(() => serializeAlmor(dbG)).toThrow(DatabaseError);
    });
  });
}
