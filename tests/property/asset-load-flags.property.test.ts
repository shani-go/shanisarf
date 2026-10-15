// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Load flags select the tables. For any `almorDocRich` text, compiled in
// memory, and any flags among `a`, `g`, `r`, `ag` and `gr`, the Asset opened
// with those flags (through either entry's `openAsset`) equals
// `parseAlmor(text, { flags })`, `flags` and `counts()` included: without
// analysis the analysis-side Views are empty and the maximum sizes 0, without
// generation the generation-side Views are empty. `analyze` agrees wherever
// analysis is set. Any other flag character throws `parseAlmor`'s
// `InvalidDatabaseFlagError`, with the same `flag` and message.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { Analyzer, InvalidDatabaseFlagError, parseAlmor } from '../../src/engine/index.js';

import { almorDocRich } from './arbitraries';
import { compileText, OPENERS, outcome, surfaceWords } from './asset-support';
import { type AnyDb, modelDifferences, sharingDifferences } from './model-compare';

const badFlags = fc
  .tuple(fc.stringMatching(/^[agr]{0,2}$/u), fc.string({ minLength: 1, maxLength: 1 }), fc.string({ maxLength: 2 }))
  .filter(([, bad]) => !'agr'.includes(bad))
  .map(([before, bad, after]) => before + bad + after);

describe('load flags select the tables', () => {
  it('opens under a, g, r, ag and gr to the model parseAlmor builds under the same flags', async () => {
    await fc.assert(
      fc.asyncProperty(
        almorDocRich,
        fc.constantFrom('a', 'g', 'r', 'ag', 'gr'),
        fc.constantFrom<'stream' | 'zlib'>('stream', 'zlib'),
        badFlags,
        async (text, flags, opener, bad) => {
          const asset = await compileText(text);
          const opened = await OPENERS[opener](asset, { flags });
          const parsed = parseAlmor(text, { flags });
          expect(modelDifferences(opened, parsed as AnyDb), flags).toEqual([]);
          expect(sharingDifferences(opened), flags).toEqual([]);
          expect(opened.flags).toEqual(parsed.flags);
          expect(opened.counts()).toEqual(parsed.counts());

          if (parsed.flags.analysis) {
            const a = new Analyzer(opened, { backoff: 'NOAN_PROP' });
            const b = new Analyzer(parsed, { backoff: 'NOAN_PROP' });
            for (const word of surfaceWords(parsed)) {
              expect(outcome(() => a.analyze(word)), word).toEqual(outcome(() => b.analyze(word)));
            }
          } else {
            expect([opened.prefixes.size, opened.suffixes.size, opened.stems.size, opened.prefixStemCompat.size]).toEqual([0, 0, 0, 0]);
            expect([opened.maxPrefixSize, opened.maxSuffixSize]).toEqual([0, 0]);
          }
          if (!parsed.flags.generation) {
            expect([opened.lemmaHash.size, opened.prefixCatHash.size, opened.suffixCatHash.size, opened.stemPrefixCompat.size]).toEqual([0, 0, 0, 0]);
          }

          let want: unknown;
          try {
            parseAlmor(text, { flags: bad });
          } catch (e) {
            want = e;
          }
          const got = await OPENERS[opener](asset, { flags: bad }).catch((e: unknown) => e);
          expect(want).toBeInstanceOf(InvalidDatabaseFlagError);
          expect(got).toBeInstanceOf(InvalidDatabaseFlagError);
          expect([(got as InvalidDatabaseFlagError).flag, (got as Error).message]).toEqual([
            (want as InvalidDatabaseFlagError).flag,
            (want as Error).message,
          ]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
