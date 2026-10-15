// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the database model. Small hand-built models, through the
// adapter, exercise `allFeats` and `tokFeats`, and the tuple model's surface:
// `counts()`, the read-only Views and their sharing, the adapter's derived
// generation side, flag gating, `readDatabaseFlags` and Provenance. The parser
// and serializer are tested separately. Names are invented.
import { describe, expect, it } from 'vitest';

import { parseAlmor } from './almor-parser.js';
import {
  type DatabaseFlags,
  type Entry,
  MODEL,
  MorphologyDb,
  PROVENANCE,
  type Provenance,
  readDatabaseFlags,
  tupleModelOf,
} from './database.js';
import { InvalidDatabaseFlagError } from './errors.js';

/** A minimal valid model with just enough to exercise the query methods. */
function makeDb(): MorphologyDb {
  return new MorphologyDb({
    flags: { analysis: true, generation: false, reinflection: false },
    defines: new Map<string, string[] | null>([
      ['pos', ['noun', 'verb']],
      ['gen', ['m', 'f']],
      ['prc0', null], // an open class
    ]),
    defaults: new Map(),
    order: null,
    tokenizations: new Set(['d3tok', 'd3seg']),
    computeFeats: new Set(),
    stemBackoffs: new Map(),
    prefixes: new Map<string, Entry[]>(),
    suffixes: new Map<string, Entry[]>(),
    stems: new Map<string, Entry[]>(),
    prefixStemCompat: new Map(),
    stemSuffixCompat: new Map(),
    prefixSuffixCompat: new Map(),
    maxPrefixSize: 0,
    maxSuffixSize: 0,
  });
}

describe('MorphologyDb.allFeats', () => {
  it('returns the define names, including open classes', () => {
    expect(makeDb().allFeats()).toEqual(new Set(['pos', 'gen', 'prc0']));
  });

  it('returns a fresh set each call that does not alias the model', () => {
    const db = makeDb();
    const feats = db.allFeats();
    feats.add('injected');
    expect(db.allFeats().has('injected')).toBe(false);
    expect(db.defines.has('injected')).toBe(false);
  });
});

describe('MorphologyDb.tokFeats', () => {
  it('returns the tokenization feature names', () => {
    expect(makeDb().tokFeats()).toEqual(new Set(['d3tok', 'd3seg']));
  });

  it('returns a copy that does not alias the model', () => {
    const db = makeDb();
    const feats = db.tokFeats();
    feats.add('injected');
    expect(db.tokFeats().has('injected')).toBe(false);
    expect(db.tokenizations.has('injected')).toBe(false);
  });
});

/** A hand-built model with two prefix lines under one surface, two stems, and AB/BC/AC rows. */
function makeTableDb(flags: DatabaseFlags): MorphologyDb {
  const pre = (category: string, diac: string): Entry => ({ category, features: { diac, bw: `${diac}/P` } });
  const stem = (category: string, diac: string, lex: string): Entry => ({
    category,
    features: { diac, lex, pos: 'noun' },
  });
  return new MorphologyDb({
    flags,
    defines: new Map<string, string[] | null>([['pos', ['noun']], ['diac', null], ['lex', null], ['bw', null]]),
    defaults: new Map([['noun', { pos: 'noun' }]]),
    order: ['pos'],
    tokenizations: new Set(),
    computeFeats: new Set(['pos']),
    stemBackoffs: new Map([['ALL', ['S1']]]),
    prefixes: new Map([['w', [pre('P1', 'wa'), pre('P2', 'wi')]]]),
    suffixes: new Map([['', [{ category: 'X1', features: { diac: '' } }]]]),
    stems: new Map([
      ['ktb', [stem('S1', 'kataba', 'katab')]],
      ['qra', [stem('S2', 'qara', 'qara'), stem('S1', 'qira', 'katab')]],
    ]),
    prefixStemCompat: new Map([['P1', new Set(['S1', 'S2'])], ['P2', new Set(['S2'])]]),
    stemSuffixCompat: new Map([['S1', new Set(['X1'])]]),
    prefixSuffixCompat: new Map([['P1', new Set(['X1'])]]),
    maxPrefixSize: 1,
    maxSuffixSize: 0,
  });
}

const R_FLAGS: DatabaseFlags = { analysis: true, generation: true, reinflection: true };
const A_FLAGS: DatabaseFlags = { analysis: true, generation: false, reinflection: false };

describe('MorphologyDb.counts', () => {
  it('counts the tables, the generation side and the Layouts without reading a View', () => {
    expect(makeTableDb(R_FLAGS).counts()).toEqual({
      prefixSurfaces: 1,
      prefixEntries: 2,
      maxPrefixSize: 1,
      suffixSurfaces: 1,
      suffixEntries: 1,
      maxSuffixSize: 0,
      stemSurfaces: 2,
      stemEntries: 3,
      tablePairsAB: 3,
      tablePairsBC: 1,
      tablePairsAC: 1,
      prefixCategories: 2,
      prefixRecords: 2,
      suffixCategories: 1,
      suffixRecords: 1,
      lemmas: 2,
      lemmaStems: 3,
      stemPrefixCategories: 2,
      stemPrefixPairs: 3,
      featureNames: expect.any(Number),
      prefixLayouts: 1,
      suffixLayouts: 1,
      stemLayouts: 1,
    });
    expect(Object.isFrozen(makeTableDb(A_FLAGS).counts())).toBe(true);
  });

  it('counts 0 for the side a flag leaves out', () => {
    const counts = makeTableDb(A_FLAGS).counts();
    expect([counts.prefixCategories, counts.lemmas, counts.stemPrefixPairs]).toEqual([0, 0, 0]);
  });
});

describe('MorphologyDb Views', () => {
  it('reads back the init in its order, entries frozen', () => {
    const db = makeTableDb(A_FLAGS);
    expect([...db.prefixes.keys()]).toEqual(['w']);
    const entries = db.prefixes.get('w')!;
    expect(entries.map((e) => [e.category, e.features])).toEqual([
      ['P1', { diac: 'wa', bw: 'wa/P' }],
      ['P2', { diac: 'wi', bw: 'wi/P' }],
    ]);
    expect(Object.isFrozen(entries)).toBe(true);
    expect(Object.isFrozen(entries[0])).toBe(true);
    expect(Object.isFrozen(entries[0]!.features)).toBe(true);
    expect(db.prefixes.get('w')).toBe(entries);
    expect([...db.stems.keys()]).toEqual(['ktb', 'qra']);
    expect(db.stems.get('absent')).toBeUndefined();
    expect(db.stems.has('qra')).toBe(true);
    expect(db.stems.size).toBe(2);
  });

  it('gives compatibility rows as read-only Sets in table order', () => {
    const db = makeTableDb(A_FLAGS);
    expect([...db.prefixStemCompat].map(([k, v]) => [k, [...v]])).toEqual([
      ['P1', ['S1', 'S2']],
      ['P2', ['S2']],
    ]);
    const row = db.prefixStemCompat.get('P1')!;
    expect(row).toBeInstanceOf(Set);
    expect(() => (row as Set<string>).add('S9')).toThrow(TypeError);
    expect(() => (row as Set<string>).delete('S1')).toThrow(TypeError);
    expect(() => (row as Set<string>).clear()).toThrow(TypeError);
    expect([...row]).toEqual(['S1', 'S2']);
    expect(db.prefixStemCompat.get('P9')).toBeUndefined();
  });

  it('shares each entry across the analysis and generation Views', () => {
    const db = makeTableDb(R_FLAGS);
    const [p1, p2] = db.prefixes.get('w')!;
    expect(db.prefixCatHash.get('P1')![0]).toBe(p1!.features);
    expect(db.prefixCatHash.get('P2')![0]).toBe(p2!.features);
    const lemma = db.lemmaHash.get('katab')!;
    expect(lemma).toHaveLength(2);
    expect(lemma[0]).toBe(db.stems.get('ktb')![0]);
    expect(lemma[1]).toBe(db.stems.get('qra')![1]);
  });

  it('derives AB transposed from AB under generation', () => {
    const db = makeTableDb(R_FLAGS);
    expect([...db.stemPrefixCompat].map(([k, v]) => [k, [...v]])).toEqual([
      ['S1', ['P1']],
      ['S2', ['P1', 'P2']],
    ]);
  });

  it('leaves a flag\'s Views empty when the flag is off', () => {
    const a = makeTableDb(A_FLAGS);
    expect([a.prefixCatHash.size, a.suffixCatHash.size, a.lemmaHash.size, a.stemPrefixCompat.size]).toEqual([0, 0, 0, 0]);
    const g = makeTableDb({ analysis: false, generation: true, reinflection: true });
    expect([g.prefixes.size, g.suffixes.size, g.stems.size, g.prefixStemCompat.size]).toEqual([0, 0, 0, 0]);
    expect(g.prefixCatHash.size).toBe(2);
  });

  it('copies the header sections, so the caller\'s Maps cannot change the model', () => {
    const defines = new Map<string, string[] | null>([['pos', ['noun']]]);
    const db = new MorphologyDb({
      flags: A_FLAGS,
      defines,
      defaults: new Map(),
      order: null,
      tokenizations: new Set(),
      computeFeats: new Set(),
      stemBackoffs: new Map(),
      prefixes: new Map(),
      suffixes: new Map(),
      stems: new Map(),
      prefixStemCompat: new Map(),
      stemSuffixCompat: new Map(),
      prefixSuffixCompat: new Map(),
      maxPrefixSize: 0,
      maxSuffixSize: 0,
    });
    defines.set('gen', null);
    defines.get('pos')!.push('verb');
    expect([...db.defines]).toEqual([['pos', ['noun']]]);
  });
});

describe('readDatabaseFlags', () => {
  it('reads a, g and r one character at a time, as the parser does', () => {
    expect(readDatabaseFlags('a')).toEqual({ analysis: true, generation: false, reinflection: false });
    expect(readDatabaseFlags('g')).toEqual({ analysis: false, generation: true, reinflection: true });
    expect(readDatabaseFlags('r')).toEqual({ analysis: true, generation: true, reinflection: true });
    expect(readDatabaseFlags('ag')).toEqual(readDatabaseFlags('r'));
    expect(readDatabaseFlags('')).toEqual({ analysis: false, generation: false, reinflection: false });
  });

  it('refuses the first other character with the parser\'s error', () => {
    for (const flags of ['x', 'ax', 'gxr', 'A']) {
      const bad = [...flags].find((c) => !'agr'.includes(c))!;
      expect(() => readDatabaseFlags(flags)).toThrow(InvalidDatabaseFlagError);
      expect(() => readDatabaseFlags(flags)).toThrow(new InvalidDatabaseFlagError(bad).message);
      expect(() => parseAlmor('', { flags })).toThrow(new InvalidDatabaseFlagError(bad).message);
    }
  });
});

describe('MorphologyDb.provenance', () => {
  const record: Provenance = {
    id: 'invented-db',
    name: 'Invented DB',
    version: '0.1',
    license: { id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    credits: 'invented credits',
    disclaimer: 'invented disclaimer',
    citation: 'invented citation',
    source: 'https://example.invalid/db',
    sourceSha256: '0'.repeat(64),
    sourceBytes: 1,
    formatVersion: 1,
    assetDigest: 'f'.repeat(64),
  };

  it('is null for a parsed model and for a hand-built one', () => {
    expect(parseAlmor('').provenance).toBeNull();
    expect(makeDb().provenance).toBeNull();
  });

  it('is a frozen copy of the record handed over under the internal key', () => {
    const model = tupleModelOf(parseAlmor('', { flags: 'r' }));
    const license = { ...record.license };
    const given = { ...record, license };
    const db = new MorphologyDb({ [MODEL]: model, [PROVENANCE]: given });
    expect(db.provenance).toEqual(record);
    expect(Object.isFrozen(db.provenance)).toBe(true);
    expect(Object.isFrozen(db.provenance!.license)).toBe(true);
    license.id = 'changed';
    expect(db.provenance!.license.id).toBe('CC0-1.0');
    expect(new MorphologyDb({ [MODEL]: model }).provenance).toBeNull();
    expect(new MorphologyDb({ [MODEL]: model, [PROVENANCE]: null }).provenance).toBeNull();
  });
});
