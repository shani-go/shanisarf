// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The analyzer parity replay. Reads every analyzer fixture under
// `fixtures/parity/`, builds an Analyzer from each fixture's header, and
// asserts that `canonicalOrder(analyze(word))` equals CAMeL Tools' recorded
// analyses: same length, and at each index the same key set and values. The
// comparison is a multiset in Canonical_Order, since CAMeL Tools can emit the
// same reading twice. Skips with a loud notice when the git-ignored database
// under `data/` is absent; fails, not skips, when a fixture's recorded
// `database.sha256` differs from the loaded file's. A `knownDrift` word is
// checked against the host-side classification, never counted as a failure.

import { describe, expect, it } from 'vitest';

import { type Analysis, canonicalOrder } from './canonical';
import {
  analyzerFromHeader,
  assertAnalysesEqual,
  hostClassify,
  listAnalyzerFixtures,
  REPLAY_MODE,
  replayAvailable,
  replayDatabase,
  SETUP_HINT,
} from './replay-support';

const available = replayAvailable();

if (!available) {
  // Skip with a loud notice, not a silent pass, so a
  // developer sees exactly how to make the suite run.
  describe.skip('analyzer parity', () => {
    it(`is skipped: the Database_Pin is absent — run \`${SETUP_HINT}\``, () => {
      /* skipped — data/ lacks the Database_Pin */
    });
  });
} else {
  const fixtures = listAnalyzerFixtures();
  const { db, sha256 } = await replayDatabase('a');

  describe(`analyzer parity${REPLAY_MODE}`, () => {
    it('has analyzer fixtures to replay', () => {
      expect(fixtures.length).toBeGreaterThan(0);
    });

    // The listing is not recursive,
    // so the generation fixtures under generation/ are never replayed here.
    it('reads only the top-level analyzer fixtures, not generation/', () => {
      for (const fixture of fixtures) {
        expect(fixture.file).not.toContain('/');
        expect(fixture).not.toHaveProperty('component');
      }
    });

    for (const fixture of fixtures) {
      describe(fixture.file, () => {
        // Fail, not skip, when the fixture was generated against a different
        // database than the one loaded: a
        // silent mismatch would make every "pass" below meaningless.
        it('fixture database.sha256 matches the loaded Database_Pin', () => {
          expect(fixture.database.sha256).toBe(sha256);
        });

        const analyzer = analyzerFromHeader(db, fixture.analyzer);
        const { backoff, strictDigit } = fixture.analyzer;
        const mode = `${backoff} strict=${strictDigit}`;

        // A knownDrift word is a documented
        // divergence. Assert the port routes it to the host-side class the
        // fixture recorded, and report it; it is never a parity failure. Every
        // committed fixture carries an empty knownDrift today, so this is the
        // mechanism, exercised the moment the host and CAMeL Tools diverge.
        const driftWords = new Set(fixture.knownDrift.map((d) => d.word));
        for (const drift of fixture.knownDrift) {
          it(`knownDrift: "${drift.word}" (reference=${drift.reference}, host=${drift.host})`, () => {
            expect(hostClassify(drift.word, strictDigit)).toBe(drift.host);
          });
        }

        fixture.cases.forEach((parityCase, caseIndex) => {
          // knownDrift words are checked above against the host expectation,
          // not against CAMeL Tools' analyses, so skip them in the parity
          // comparison.
          if (driftWords.has(parityCase.word)) {
            return;
          }
          it(`case ${caseIndex} word=${JSON.stringify(parityCase.word)}`, () => {
            const expected = canonicalOrder(parityCase.analyses);
            const actual = canonicalOrder(analyzer.analyze(parityCase.word) as Analysis[]);
            assertAnalysesEqual(actual, expected, `word=${JSON.stringify(parityCase.word)} mode=${mode}`);
          });
        });
      });
    }
  });
}
