// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Generator request precedence, over the Database_Pin parsed with `r`: an
// unknown lemma returns [] for any request, even an invalid one; for a known
// lemma, an undefined key throws InvalidGeneratorFeature naming the first such
// key, a closed-define value outside its list throws
// InvalidGeneratorFeatureValue, a missing pos throws
// InvalidGeneratorFeatureValue('pos', None), and a valid key absent from the
// pos's DEFAULTS row returns []; `lemma`, `lemma + '_1'` and `lemma + '-a'`
// return equal results. Every DEFAULTS row of the pin carries all 53 defined
// features, so the "absent" clause runs on a view with one key removed. Skips
// with the replay notice when `data/` lacks the pin.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { joinModel, splitModel } from '../../src/engine/database.js';
import { Generator } from '../../src/engine/index.js';
import { stripLex } from '../../src/engine/features.js';
import {
  databaseAvailable,
  loadReinflectionDatabase,
  SETUP_HINT,
} from '../parity/replay-support';

import { arAr } from './arbitraries';

/** Feature names no ALMOR database defines (checked below). */
const UNDEFINED_KEYS = ['xyz', 'qqq', 'not_a_feature'];
/** A value outside every closed define of the pin (checked below). */
const INVALID_VALUE = 'invalid';

type Clause =
  | { kind: 'unknown'; lemma: string; feats: Record<string, string> }
  | { kind: 'undefined'; lemma: string; feats: Record<string, string>; first: string }
  | { kind: 'value'; lemma: string; feats: Record<string, string>; key: string }
  | { kind: 'missing-pos'; lemma: string; feats: Record<string, string> }
  | { kind: 'outside-row'; lemma: string; pos: string; key: string; value: string }
  | { kind: 'suffixes'; lemma: string; pos: string };

/** Call `fn` and return what it threw, or `undefined`. */
function thrown(fn: () => unknown): Error | undefined {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  return undefined;
}

if (!databaseAvailable()) {
  describe.skip('generator precedence', () => {
    it(`is skipped: the Database_Pin is absent — run \`${SETUP_HINT}\``, () => {
      /* skipped — data/ lacks the Database_Pin */
    });
  });
} else {
  const { db } = loadReinflectionDatabase();
  const generator = new Generator(db);
  const lemmas = [...db.lemmaHash.keys()];
  const closedKeys = [...db.defines.entries()]
    .filter(([key, values]) => values !== null && key !== 'pos')
    .map(([key]) => key);

  const firstPos = (lemma: string): string =>
    db.lemmaHash.get(lemma)?.[0]?.features['pos'] as string;
  const validValue = (key: string): string => (db.defines.get(key) as string[])[0] as string;

  const lemmaArb = fc.integer({ min: 0, max: lemmas.length - 1 }).map((i) => lemmas[i] as string);
  const closedKeyArb = fc.constantFrom(...closedKeys);

  const clauseArb: fc.Arbitrary<Clause> = fc.oneof(
    // Unknown lemma, any request (keys and values from small mixed pools).
    fc
      .tuple(
        arAr,
        fc.dictionary(
          fc.constantFrom('pos', 'num', ...UNDEFINED_KEYS),
          fc.constantFrom('noun', 'verb', 'p', INVALID_VALUE, ''),
          { maxKeys: 3 },
        ),
      )
      .filter(([lemma]) => !db.lemmaHash.has(stripLex(lemma)))
      .map(([lemma, feats]): Clause => ({ kind: 'unknown', lemma, feats })),
    // Undefined keys inserted among valid ones.
    fc
      .tuple(
        lemmaArb,
        fc.option(closedKeyArb, { nil: undefined }),
        fc.uniqueArray(fc.constantFrom(...UNDEFINED_KEYS), { minLength: 1, maxLength: 2 }),
        fc.nat(),
      )
      .map(([lemma, key, undefinedKeys, at]): Clause => {
        const entries: [string, string][] = [['pos', firstPos(lemma)]];
        if (key !== undefined) {
          entries.push([key, validValue(key)]);
        }
        entries.splice(at % (entries.length + 1), 0, ...undefinedKeys.map((k): [string, string] => [k, '1']));
        return { kind: 'undefined', lemma, feats: Object.fromEntries(entries), first: undefinedKeys[0] as string };
      }),
    // A closed-define value outside its list.
    fc.tuple(lemmaArb, closedKeyArb).map(([lemma, key]): Clause => ({
      kind: 'value',
      lemma,
      feats: { pos: firstPos(lemma), [key]: INVALID_VALUE },
      key,
    })),
    // A request without pos.
    fc.tuple(lemmaArb, closedKeyArb).map(([lemma, key]): Clause => ({
      kind: 'missing-pos',
      lemma,
      feats: { [key]: validValue(key) },
    })),
    // A valid key absent from the pos's DEFAULTS row.
    fc.tuple(lemmaArb, closedKeyArb).map(([lemma, key]): Clause => ({
      kind: 'outside-row',
      lemma,
      pos: firstPos(lemma),
      key,
      value: validValue(key),
    })),
    // Lemma suffixes.
    lemmaArb.map((lemma): Clause => ({ kind: 'suffixes', lemma, pos: firstPos(lemma) })),
  );

  describe('generator precedence', () => {
    it('the invented keys and value are outside the pin', () => {
      for (const key of UNDEFINED_KEYS) {
        expect(db.defines.has(key)).toBe(false);
      }
      for (const values of db.defines.values()) {
        expect(values?.includes(INVALID_VALUE) ?? false).toBe(false);
      }
    });

    it('generator request precedence', { timeout: 60_000 }, () => {
      fc.assert(
        fc.property(clauseArb, (clause) => {
          switch (clause.kind) {
            case 'unknown':
              expect(generator.generate(clause.lemma, clause.feats)).toEqual([]);
              break;
            case 'undefined': {
              const err = thrown(() => generator.generate(clause.lemma, clause.feats));
              expect(err?.name).toBe('InvalidGeneratorFeature');
              expect(err?.message).toBe(`Invalid feature '${clause.first}'`);
              break;
            }
            case 'value': {
              const err = thrown(() => generator.generate(clause.lemma, clause.feats));
              expect(err?.name).toBe('InvalidGeneratorFeatureValue');
              expect(err?.message).toBe(`Invalid value '${INVALID_VALUE}' for feature '${clause.key}'`);
              break;
            }
            case 'missing-pos': {
              const err = thrown(() => generator.generate(clause.lemma, clause.feats));
              expect(err?.name).toBe('InvalidGeneratorFeatureValue');
              expect(err?.message).toBe("Invalid value None for feature 'pos'");
              break;
            }
            case 'outside-row': {
              const row = { ...(db.defaults.get(clause.pos) as Record<string, string | null>) };
              delete row[clause.key];
              const defaults = new Map(db.defaults);
              defaults.set(clause.pos, row);
              // The same model with one DEFAULTS row edited: a built model is
              // read-only, so the variant shares its tables and replaces the
              // header's defaults (splitModel/joinModel).
              const [header, stem] = splitModel(db);
              const view = joinModel({ ...header, header: { ...header.header, defaults } }, stem);
              const feats = { pos: clause.pos, [clause.key]: clause.value };
              expect(new Generator(view).generate(clause.lemma, feats)).toEqual([]);
              break;
            }
            case 'suffixes': {
              const feats = { pos: clause.pos };
              const plain = generator.generate(clause.lemma, feats);
              expect(generator.generate(`${clause.lemma}_1`, feats)).toEqual(plain);
              expect(generator.generate(`${clause.lemma}-a`, feats)).toEqual(plain);
              break;
            }
          }
        }),
        { numRuns: 50 },
      );
    });
  });
}
