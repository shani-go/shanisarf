// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Lookups equal the Views, and leave the memo empty. For any `lexiconDoc`
// text parsed under `a` and `r` (under `g` the constructor throws): every
// lookup of every key the text holds, and a few it does not, returns exactly
// the stem entries a filter over `db.stems` selects, in line order, with a
// drawn `features` list giving the subset in Layout order; `entries()` and
// `size` match the stem table; the indexes are the model's own or have the
// KeyIndex shape; and the Views' EntryMemo stays empty.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseAlmor } from '../../src/engine/almor-parser.js';
import { tupleModelOf } from '../../src/engine/database.js';
import { DatabaseError } from '../../src/engine/errors.js';
import { Lexicon, lexiconIndexesOf } from '../../src/engine/lexicon.js';
import { entryMemoOf } from '../../src/engine/model-views.js';

import { keyIndexShapeErrors, keyOf, lexiconDoc, LOOKUP_KEYS, memoCount, type Plain, plainOf, viewLines } from './lexicon-support';

const FEATURE_NAMES = ['diac', 'lex', 'pos', 'gen', 'bw', 'root', 'nothing'];
const ABSENT_KEYS = ['', 'zz', 'غغ'];

function subset(plain: Plain, names: ReadonlySet<string>): Plain {
  return [plain[0], plain[1], plain[2].filter(([name]) => names.has(name))];
}

describe('lookups equal the Views, and leave the memo empty', () => {
  it('equals a filter over db.stems in line order, reuses the model\'s indexes, and touches no memo', { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(
        lexiconDoc,
        fc.shuffledSubarray(FEATURE_NAMES),
        (text, features) => {
          expect(() => new Lexicon(parseAlmor(text, { flags: 'g' }))).toThrow(DatabaseError);

          for (const flags of ['a', 'r'] as const) {
            const db = parseAlmor(text, { flags });
            const model = tupleModelOf(db);
            const lexicon = new Lexicon(db);
            const lines = viewLines(parseAlmor(text, { flags }), text);
            const memo = entryMemoOf(db.stems);
            const held = memoCount(memo);
            const untouched = (what: string): void => {
              expect(memoCount(memo), `${flags} ${what}`).toBe(held);
            };
            const names = new Set(features);

            expect(lexicon.size).toBe(lines.length);
            expect(lexicon.size).toBe(model.stem.stems.count);

            expect([...lexicon.entries()].map(plainOf)).toEqual(lines.map((l) => l.plain));
            untouched('entries()');
            expect([...lexicon.entries({ features })].map(plainOf)).toEqual(lines.map((l) => subset(l.plain, names)));
            untouched('entries({ features })');

            const keys = new Set<string>(ABSENT_KEYS);
            for (const line of lines) {
              for (const by of LOOKUP_KEYS) {
                const k = keyOf(by, line);
                if (k !== undefined) keys.add(k);
              }
            }

            for (const by of LOOKUP_KEYS) {
              const method = by === 'lemma' ? 'byLemma' : by === 'stem' ? 'byStem' : 'byRoot';
              for (const key of keys) {
                const expected = lines.filter((l) => keyOf(by, l) === key).map((l) => l.plain);
                const label = `${flags} ${by} ${JSON.stringify(key)}`;
                expect(lexicon.lookup(by, key).map(plainOf), label).toEqual(expected);
                untouched(label);
                expect(lexicon[method](key).map(plainOf), `${label} ${method}`).toEqual(expected);
                untouched(`${label} ${method}`);
                expect(lexicon.lookup(by, key, { features }).map(plainOf), `${label} features`).toEqual(
                  expected.map((p) => subset(p, names)),
                );
                untouched(`${label} features`);
                if (ABSENT_KEYS.includes(key)) {
                  expect(lexicon.lookup(by, key), label).toEqual([]);
                }
              }
            }

            const indexes = lexiconIndexesOf(lexicon);
            expect(indexes.stem).toBe(model.stem.stemIndex);
            if (flags === 'r') {
              expect(model.stem.lemmaIndex).not.toBeNull();
              expect(indexes.lemma).toBe(model.stem.lemmaIndex);
            } else {
              expect(model.stem.lemmaIndex).toBeNull();
              expect(indexes.lemma).not.toBeNull();
              expect(keyIndexShapeErrors(indexes.lemma!), 'built lemma index').toEqual([]);
            }
            expect(indexes.root).not.toBeNull();
            expect(keyIndexShapeErrors(indexes.root!), 'built root index').toEqual([]);
            untouched('the end');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
