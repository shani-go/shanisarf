// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Flags build CAMeL Tools' tables: for `almorDoc` and flag strings, the parsed
// affix, stem and compatibility tables equal the ones read off the document
// text by a reader written here (`readDoc`), not by the parser under test. The
// Database_Pin's `g` parse is checked against its measured table counts; that
// case skips when `data/` lacks the pin.

import { readFileSync } from 'node:fs';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  InvalidDatabaseFlagError,
  type MorphologyDb,
  parseAlmor,
} from '../../src/engine/index.js';
import { stripLex } from '../../src/engine/features.js';
import { databaseAvailable, DB_PATH, SETUP_HINT } from '../parity/replay-support';

import { almorDoc } from './arbitraries';

interface DocLine {
  surface: string;
  category: string;
  features: Record<string, string>;
}

interface DocTables {
  prefixes: DocLine[];
  suffixes: DocLine[];
  stems: DocLine[];
  ab: [string, string][];
  bc: [string, string][];
  ac: [string, string][];
}

/** Read the affix, stem and table lines of a well-formed `almorDoc` text. */
function readDoc(text: string): DocTables {
  const out: DocTables = { prefixes: [], suffixes: [], stems: [], ab: [], bc: [], ac: [] };
  let section = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('###')) {
      section = line;
      continue;
    }
    if (line === '') {
      continue;
    }
    const entry = (): DocLine => {
      const [surface, category, feats] = line.split('\t') as [string, string, string];
      const features: Record<string, string> = {};
      for (const tok of feats.split(' ')) {
        const [key, ...rest] = tok.split(':');
        features[key as string] = rest.join(':');
      }
      return { surface, category, features };
    };
    const pair = (): [string, string] => line.split(' ') as [string, string];
    if (section === '###PREFIXES###') out.prefixes.push(entry());
    else if (section === '###SUFFIXES###') out.suffixes.push(entry());
    else if (section === '###STEMS###') out.stems.push(entry());
    else if (section === '###TABLE AB###') out.ab.push(pair());
    else if (section === '###TABLE BC###') out.bc.push(pair());
    else if (section === '###TABLE AC###') out.ac.push(pair());
  }
  return out;
}

/** Group values under keys, keys and values in first-seen order. */
function groupBy<T>(items: T[], keyOf: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list === undefined) map.set(key, [item]);
    else list.push(item);
  }
  return [...map.entries()];
}

/** A compatibility table as `[left, [rights…]]` pairs, keeping insertion order. */
function tableOf(pairs: [string, string][]): [string, string[]][] {
  return groupBy(pairs, ([left]) => left).map(([left, ps]) => [
    left,
    [...new Set(ps.map(([, right]) => right))],
  ]);
}

/** A model's table as `[left, [rights…]]`, in the model's insertion order. */
function modelTable(table: ReadonlyMap<string, ReadonlySet<string>>): [string, string[]][] {
  return [...table.entries()].map(([left, rights]) => [left, [...rights]]);
}

/** Flag characters: the three valid ones and a few that must be refused. */
const flagChar = fc.constantFrom('a', 'g', 'r', 'a', 'g', 'r', 'x', 'G', 'R', '-', ' ', 'ا');

describe('generation tables', () => {
  it('flags build CAMeL Tools\' tables', () => {
    fc.assert(
      fc.property(almorDoc, fc.array(flagChar, { minLength: 1, maxLength: 3 }), (text, chars) => {
        const flags = chars.join('');
        const bad = chars.find((c) => c !== 'a' && c !== 'g' && c !== 'r');

        // Bad flag: the first character that is none of a, g, r is named.
        if (bad !== undefined) {
          let thrown: unknown;
          try {
            parseAlmor(text, { flags });
          } catch (err) {
            thrown = err;
          }
          expect(thrown).toBeInstanceOf(InvalidDatabaseFlagError);
          expect((thrown as InvalidDatabaseFlagError).flag).toBe(bad);
          return;
        }

        const analysis = chars.includes('a') || chars.includes('r');
        const generation = chars.includes('g') || chars.includes('r');
        const db = parseAlmor(text, { flags });
        const doc = readDoc(text);

        // Flags record (16.1, 16.2).
        expect(db.flags).toEqual({ analysis, generation, reinflection: generation });

        // Generation tables (16.3).
        if (generation) {
          expect([...db.prefixCatHash.entries()]).toEqual(
            groupBy(doc.prefixes, (l) => l.category).map(([c, ls]) => [c, ls.map((l) => l.features)]),
          );
          expect([...db.suffixCatHash.entries()]).toEqual(
            groupBy(doc.suffixes, (l) => l.category).map(([c, ls]) => [c, ls.map((l) => l.features)]),
          );
          const stemLines = doc.stems.map((l) => ({
            category: l.category,
            features: { ...l.features, lex: stripLex(l.features['lex'] as string) },
          }));
          expect([...db.lemmaHash.entries()]).toEqual(
            groupBy(stemLines, (l) => l.features['lex'] as string),
          );
          expect(modelTable(db.stemPrefixCompat)).toEqual(
            tableOf(doc.ab.map(([p, s]) => [s, p])),
          );
          if (analysis) {
            // The same objects as the analysis-side entries.
            const sameObjects = (
              records: Iterable<readonly Readonly<Record<string, string>>[]>,
              entries: ReadonlyMap<string, readonly { readonly features: Readonly<Record<string, string>> }[]>,
            ): void => {
              const held = new Set([...entries.values()].flat().map((e) => e.features));
              for (const record of [...records].flat()) {
                expect(held.has(record)).toBe(true);
              }
            };
            sameObjects(db.prefixCatHash.values(), db.prefixes);
            sameObjects(db.suffixCatHash.values(), db.suffixes);
            const stemEntries = new Set([...db.stems.values()].flat());
            for (const entry of [...db.lemmaHash.values()].flat()) {
              expect(stemEntries.has(entry)).toBe(true);
            }
          }
        } else {
          expect(db.prefixCatHash.size).toBe(0);
          expect(db.suffixCatHash.size).toBe(0);
          expect(db.lemmaHash.size).toBe(0);
          expect(db.stemPrefixCompat.size).toBe(0);
        }

        // Analysis off (16.4): the analysis maps empty, both sizes 0; BC and
        // AC are built whatever the flags.
        if (!analysis) {
          expect(db.prefixes.size).toBe(0);
          expect(db.suffixes.size).toBe(0);
          expect(db.stems.size).toBe(0);
          expect(db.prefixStemCompat.size).toBe(0);
          expect(db.maxPrefixSize).toBe(0);
          expect(db.maxSuffixSize).toBe(0);
        } else {
          expect(modelTable(db.prefixStemCompat)).toEqual(tableOf(doc.ab));
        }
        expect(modelTable(db.stemSuffixCompat)).toEqual(tableOf(doc.bc));
        expect(modelTable(db.prefixSuffixCompat)).toEqual(tableOf(doc.ac));

        // No mutation (16.5): every entry's keys are the keys its line gave.
        const lineKeys = new Set(
          [...doc.prefixes, ...doc.suffixes, ...doc.stems].map((l) => Object.keys(l.features).join(' ')),
        );
        const entries = [
          ...[...db.prefixes.values()].flat(),
          ...[...db.suffixes.values()].flat(),
          ...[...db.stems.values()].flat(),
          ...[...db.lemmaHash.values()].flat(),
        ];
        for (const entry of entries) {
          expect(lineKeys.has(Object.keys(entry.features).join(' '))).toBe(true);
        }
        for (const record of [...db.prefixCatHash.values(), ...db.suffixCatHash.values()].flat()) {
          expect(lineKeys.has(Object.keys(record).join(' '))).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// The Database_Pin's `g` parse against its measured table counts.
if (!databaseAvailable()) {
  describe.skip('Database_Pin g parse', () => {
    it(`is skipped: the Database_Pin is absent — run \`${SETUP_HINT}\``, () => {
      /* skipped — data/ lacks the Database_Pin */
    });
  });
} else {
  describe('Database_Pin g parse', () => {
    it('has the generation table counts', { timeout: 60_000 }, () => {
      const db: MorphologyDb = parseAlmor(readFileSync(DB_PATH, 'utf8'), { flags: 'g' });
      const records = (hash: ReadonlyMap<string, readonly unknown[]>): number =>
        [...hash.values()].reduce((n, list) => n + list.length, 0);
      const pairs = (table: ReadonlyMap<string, ReadonlySet<string>>): number =>
        [...table.values()].reduce((n, set) => n + set.size, 0);

      expect(db.flags).toEqual({ analysis: false, generation: true, reinflection: true });
      expect(db.prefixCatHash.size).toBe(221);
      expect(records(db.prefixCatHash)).toBe(12_724);
      expect(db.suffixCatHash.size).toBe(543);
      expect(records(db.suffixCatHash)).toBe(15_044);
      expect(db.lemmaHash.size).toBe(100_906);
      expect(records(db.lemmaHash)).toBe(175_972);
      expect(db.lemmaHash.has('NOAN')).toBe(true);
      expect(db.stemPrefixCompat.size).toBe(418);
      expect(pairs(db.stemPrefixCompat)).toBe(4_332);
      expect(db.stemSuffixCompat.size).toBe(418);
      expect(db.prefixSuffixCompat.size).toBe(221);
      expect(db.prefixes.size + db.suffixes.size + db.stems.size).toBe(0);
      expect(db.prefixStemCompat.size).toBe(0);
      expect(db.maxPrefixSize).toBe(0);
      expect(db.maxSuffixSize).toBe(0);
    });
  });
}
