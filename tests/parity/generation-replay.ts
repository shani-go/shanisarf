// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The shared body of the generator and reinflector parity replays. The pin is
// parsed once per worker with `{ flags: 'r' }`; the suite skips with the
// replay notice when `data/` lacks it. Analyses compare in Canonical_Order with
// exact values, an error by class name and message, and a `referenceRaises`
// case against the Defined_Twin's analyses, reported as a documented
// divergence, never a parity failure.

import { describe, expect, it } from 'vitest';

import type { MorphologyDb } from '../../src/engine/index.js';

import { type Analysis, canonicalOrder } from './canonical';
import {
  assertAnalysesEqual,
  type GenerationCase,
  readGenerationFixture,
  REPLAY_MODE,
  replayAvailable,
  replayDatabase,
  SETUP_HINT,
} from './replay-support';

/** The port call a suite replays: a request in, analyses out (or a throw). */
export type GenerationCall = (
  db: MorphologyDb,
) => (head: string, feats: Record<string, string>) => Analysis[];

/** Define the replay suite for one generation fixture. */
export async function replayGeneration(title: string, fixtureFile: string, makeCall: GenerationCall): Promise<void> {
  if (!replayAvailable()) {
    describe.skip(title, () => {
      it(`is skipped: the Database_Pin is absent — run \`${SETUP_HINT}\``, () => {
        /* skipped — data/ lacks the Database_Pin */
      });
    });
    return;
  }

  const fixture = readGenerationFixture(fixtureFile);
  const { db, sha256 } = await replayDatabase('r');
  const call = makeCall(db);
  const divergences = fixture.cases.filter((c) => c.referenceRaises !== undefined).length;

  describe(`${title}${REPLAY_MODE}`, () => {
    it('has cases to replay', () => {
      expect(fixture.cases.length).toBeGreaterThan(0);
    });

    it('fixture database.sha256 matches the loaded Database_Pin, parsed with r', () => {
      expect(fixture.database.sha256).toBe(sha256);
      expect(fixture.database.flags).toBe('r');
    });

    it(`reports ${divergences} documented divergence(s) where CAMeL Tools raises`, () => {
      if (divergences > 0) {
        console.info(
          `${fixture.file}: ${divergences} case(s) where CAMeL Tools raises KeyError; ` +
            'compared against the Defined_Twin.',
        );
      }
    });

    fixture.cases.forEach((c, index) => {
      const head = (c.lemma ?? c.word) as string;
      const label = `${fixture.component} ${JSON.stringify(head)} ${JSON.stringify(c.feats)}`;
      const name = c.referenceRaises !== undefined
        ? `case ${index} documented divergence (reference: ${c.referenceRaises}) ${label}`
        : `case ${index} ${label}`;
      it(name, () => replayCase(c, label, () => call(head, c.feats)));
    });
  });
}

/** Compare one case: an error by class name and message, else analyses. */
function replayCase(c: GenerationCase, label: string, run: () => Analysis[]): void {
  if (c.error !== undefined) {
    let thrown: unknown;
    try {
      run();
    } catch (err) {
      thrown = err;
    }
    expect(thrown, `${label}: expected ${c.error.type}`).toBeInstanceOf(Error);
    expect((thrown as Error).name, label).toBe(c.error.type);
    expect((thrown as Error).message, label).toBe(c.error.message);
    return;
  }
  const expected = canonicalOrder(c.analyses ?? []);
  const actual = canonicalOrder(run());
  assertAnalysesEqual(actual, expected, label);
}
