// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// An opened Asset is the parsed model. For any `almorDocRich` text, compiled
// in memory and opened with flags `r` through either entry's `openAsset`: the
// model equals `parseAlmor(text, { flags: 'r' })` (tests/property/
// model-compare.ts) and shares its entries as the engine does; `counts()` and
// `serializeAlmor` agree; `analyze` of every word the surfaces make, under
// each backoff mode, agrees at each index; and `generate` and `reinflect`
// return the parsed model's results or throw the same error. Over the
// Database_Pin, the compiled Asset serializes to the parsed text and `counts()`
// equals the facts table; that case skips with the replay notice when data/
// lacks the pin.

import { readFileSync } from 'node:fs';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compileDatabase } from '../../src/compile/compile-database.js';
import type { SourceRecord } from '../../src/compile/source-record.js';
import {
  Analyzer,
  BACKOFF_MODES,
  Generator,
  parseAlmor,
  Reinflector,
  serializeAlmor,
} from '../../src/engine/index.js';
import { DB_PATH, databaseAvailable, SETUP_HINT } from '../parity/replay-support';

import { almorDocRich } from './arbitraries';
import { compileText, OPENERS, outcome, surfaceWords } from './asset-support';
import { type AnyDb, modelDifferences, sharingDifferences } from './model-compare';

describe('an opened Asset is the parsed model', () => {
  it('equals the parsed model, and analyzes, generates and reinflects as it does', async () => {
    await fc.assert(
      fc.asyncProperty(
        almorDocRich,
        fc.constantFrom<'stream' | 'zlib'>('stream', 'zlib'),
        fc.record({ key: fc.constantFrom('pos', 'gen'), pick: fc.nat() }),
        async (text, opener, bundle) => {
          const asset = await compileText(text);
          const opened = await OPENERS[opener](asset, { flags: 'r' });
          const parsed = parseAlmor(text, { flags: 'r' });

          expect(modelDifferences(opened, parsed as AnyDb)).toEqual([]);
          expect(sharingDifferences(opened)).toEqual([]);
          expect(opened.counts()).toEqual(parsed.counts());
          expect(serializeAlmor(opened)).toBe(serializeAlmor(parsed));

          const words = surfaceWords(parsed);
          for (const backoff of BACKOFF_MODES) {
            const a = new Analyzer(opened, { backoff });
            const b = new Analyzer(parsed, { backoff });
            for (const word of words) {
              expect(outcome(() => a.analyze(word)), `${backoff} ${word}`).toEqual(outcome(() => b.analyze(word)));
            }
          }

          const genA = new Generator(opened);
          const genB = new Generator(parsed);
          for (const [lemma, stems] of parsed.lemmaHash) {
            const pos = stems[0]?.features['pos'] as string;
            expect(outcome(() => genA.generate(lemma, { pos })), lemma).toEqual(outcome(() => genB.generate(lemma, { pos })));
          }

          const values = parsed.defines.get(bundle.key) ?? [];
          const feats = { [bundle.key]: values[bundle.pick % Math.max(values.length, 1)] ?? 'x' };
          const reA = new Reinflector(opened);
          const reB = new Reinflector(parsed);
          for (const word of words) {
            expect(outcome(() => reA.reinflect(word, feats)), word).toEqual(outcome(() => reB.reinflect(word, feats)));
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

if (!databaseAvailable()) {
  describe.skip('an opened Asset is the parsed model, over the pin', () => {
    it(`skipped: the Database_Pin is not present at ${DB_PATH} (run \`${SETUP_HINT}\`)`, () => {});
  });
} else {
  describe('an opened Asset is the parsed model, over the pin', () => {
    it('opens with r to the parsed model\'s text, and counts() is the facts table', { timeout: 300_000 }, async () => {
      const pkgDir = new URL('../../packages/shanisarf-db-msa/', import.meta.url);
      const record = JSON.parse(readFileSync(new URL('source.json', pkgDir), 'utf8')) as SourceRecord;
      const bytes = readFileSync(DB_PATH);
      const asset = await compileDatabase(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), record);
      const opened = await OPENERS.zlib(asset, { flags: 'r' });
      const parsed = parseAlmor(bytes.toString('utf8'), { flags: 'r' });
      expect(serializeAlmor(opened)).toBe(serializeAlmor(parsed));
      expect(opened.counts()).toEqual(parsed.counts());
      expect(opened.counts()).toMatchObject({
        prefixSurfaces: 383,
        prefixEntries: 12_724,
        maxPrefixSize: 7,
        suffixSurfaces: 1_557,
        suffixEntries: 15_044,
        maxSuffixSize: 9,
        stemSurfaces: 96_989,
        stemEntries: 175_972,
        tablePairsAB: 4_332,
        tablePairsBC: 9_059,
        tablePairsAC: 1_432,
        prefixCategories: 221,
        prefixRecords: 12_724,
        suffixCategories: 543,
        suffixRecords: 15_044,
        lemmas: 100_906,
        lemmaStems: 175_972,
        stemPrefixCategories: 418,
        stemPrefixPairs: 4_332,
        prefixLayouts: 11,
        suffixLayouts: 6,
        stemLayouts: 17,
      });
      expect(opened.provenance?.sourceSha256).toBe(record.sourceSha256);
    });
  });
}
