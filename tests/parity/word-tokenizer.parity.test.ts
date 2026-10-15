// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The word-tokenizer parity replay: `simpleWordTokenize`, with and without
// `splitDigits`, returns exactly the token list CAMeL Tools recorded for each
// input in `fixtures/parity/word-tokenizer.json.gz` (order and multiplicity).
// Skips with a loud notice when the git-ignored database is absent, like the
// analyzer replay: the tokenizer needs no database, but the fixture's header
// is still checked against the loaded Database_Pin.

import { describe, expect, it } from 'vitest';

import { simpleWordTokenize } from '../../src/engine/index.js';
import {
  readTokenizerFixture,
  REPLAY_MODE,
  replayAvailable,
  replayDatabase,
  SETUP_HINT,
} from './replay-support';

const available = replayAvailable();

if (!available) {
  describe.skip('word tokenizer parity', () => {
    it(`is skipped: the Database_Pin is absent — run \`${SETUP_HINT}\``, () => {
      /* skipped — data/ lacks the Database_Pin */
    });
  });
} else {
  const fixture = readTokenizerFixture();
  const { sha256 } = await replayDatabase('a');

  describe(`word tokenizer parity${REPLAY_MODE}`, () => {
    it('has tokenizer cases to replay', () => {
      expect(fixture.cases.length).toBeGreaterThan(0);
    });

    // Keep the pin assertion uniform with the analyzer side: a fixture
    // generated against a different database is a mismatch worth failing on.
    it('fixture database.sha256 matches the loaded Database_Pin', () => {
      expect(fixture.database.sha256).toBe(sha256);
    });

    fixture.cases.forEach((tokenCase, i) => {
      it(`case ${i} input=${JSON.stringify(tokenCase.input)}`, () => {
        // Exact list equality for both modes.
        expect(simpleWordTokenize(tokenCase.input, false)).toEqual(tokenCase.tokens);
        expect(simpleWordTokenize(tokenCase.input, true)).toEqual(
          tokenCase.tokensSplitDigits,
        );
      });
    });
  });
}
