// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the Lexicon over an invented small database parsed under `a`
// and `r`: each lookup, the `features` subset, unknown keys, the errors,
// `entries()` and `size`, the Views' EntryMemo left empty (read through
// `entryMemoOf`), a `g` model refused by the constructor, the indexes it reuses
// and builds, and folded lookups. The lexicon-equals-views and key-fold
// properties hold the same over `almorDoc`. Words and features are invented.
import { describe, expect, it } from 'vitest';

import { parseAlmor } from './almor-parser.js';
import type { Entry, MorphologyDb } from './database.js';
import { tupleModelOf } from './database.js';
import { DatabaseError } from './errors.js';
import { Lexicon, lexiconIndexesOf, type LexiconEntry, type LookupKey } from './lexicon.js';
import { entryMemoOf, type EntryMemo } from './model-views.js';

const ROOT_KTB = 'ك.ت.ب';
const ROOT_AML_HAMZA = 'أ.م.ل';
const ROOT_AML_BARE = 'ا.م.ل';

const DB = [
  '###DEFINES###',
  'DEFINE pos pos:noun pos:verb pos:adj',
  'DEFINE num num:s num:p',
  'DEFINE diac diac:*open*',
  'DEFINE lex lex:*open*',
  'DEFINE root root:*open*',
  'DEFINE gloss gloss:*open*',
  '###DEFAULTS###',
  'DEFAULT pos:noun num:s',
  'DEFAULT pos:verb num:s',
  'DEFAULT pos:adj num:s',
  'DEFAULT pos:*',
  '###ORDER###',
  'ORDER pos num',
  '###TOKENIZATIONS###',
  'TOKENIZATION diac',
  '###STEMBACKOFF###',
  'STEMBACKOFF ALL N0',
  '###PREFIXES###',
  '\tP0\tdiac:',
  '###SUFFIXES###',
  '\tS0\tdiac:',
  '###STEMS###',
  `كتاب\tN0\tdiac:كِتاب lex:كِتاب_1 root:${ROOT_KTB} pos:noun num:s gloss:ktab`,
  `كتب\tN1\tdiac:كُتُب lex:كِتاب_1 root:${ROOT_KTB} pos:noun num:p gloss:ktab`,
  `مكتبة\tN0\tdiac:مَكْتَبَة lex:مَكْتَبَة_1 root:${ROOT_KTB} pos:noun num:s gloss:mktb`,
  `كتب\tV0\tdiac:كَتَب lex:كَتَب_1 root:${ROOT_KTB} pos:verb num:s gloss:ktb`,
  'مكتبه\tN0\tdiac:مَكْتَبَه lex:مَكْتَبَه_1 pos:noun num:s gloss:mktbh',
  `أمل\tN0\tdiac:أَمَل lex:أَمَل_1 root:${ROOT_AML_HAMZA} pos:noun num:s gloss:aml`,
  `امل\tA0\tdiac:اَمَل lex:اَمَل_1 root:${ROOT_AML_BARE} pos:adj num:s gloss:aml2`,
  `أمال\tN1\tdiac:أَمال lex:أَمَل_2 root:${ROOT_AML_HAMZA} pos:noun num:p gloss:amal`,
  '###TABLE AB###',
  'P0 N0',
  'P0 N1',
  'P0 V0',
  'P0 A0',
  '###TABLE BC###',
  'N0 S0',
  'N1 S0',
  'V0 S0',
  'A0 S0',
  '###TABLE AC###',
  'P0 S0',
  '',
].join('\n');

/** The number of entries the memo holds, over its three tables. */
function memoCount(memo: EntryMemo): number {
  const tables = (memo as unknown as { memo: Record<string, (Entry | undefined)[]> }).memo;
  let n = 0;
  for (const list of Object.values(tables)) {
    for (const entry of list) {
      if (entry !== undefined) n++;
    }
  }
  return n;
}

/** Each stem line's `diac`, in line order: unique per line in DB, so it orders the View's entries. */
const LINE_DIACS = DB.split('\n')
  .slice(DB.split('\n').indexOf('###STEMS###') + 1, DB.split('\n').indexOf('###TABLE AB###'))
  .map((line) => /diac:([^ \t]*)/u.exec(line)?.[1] as string);

/**
 * The View's entries a filter selects, as plain `[surface, category,
 * features]` triples in line order (the View walks surfaces in first-seen
 * order, so its entries are put back in line order by their `diac`).
 */
function viewEntries(db: MorphologyDb, pick: (surface: string, entry: Entry) => boolean): unknown[] {
  const out: [number, [string, string, [string, string][]]][] = [];
  for (const [surface, entries] of db.stems) {
    for (const entry of entries) {
      if (pick(surface, entry)) {
        out.push([LINE_DIACS.indexOf(entry.features['diac'] as string), [surface, entry.category, Object.entries(entry.features)]]);
      }
    }
  }
  return out.sort((x, y) => x[0] - y[0]).map((x) => x[1]);
}

function plain(records: readonly LexiconEntry[]): unknown[] {
  return records.map((r) => [r.surface, r.category, Object.entries(r.features)]);
}

describe.each(['a', 'r'])('Lexicon under %s', (flags) => {
  const parse = (): MorphologyDb => parseAlmor(DB, { flags });

  it('reads the model without the Views: the memo stays empty', () => {
    const db = parse();
    const lexicon = new Lexicon(db);
    for (const by of ['lemma', 'stem', 'root'] as const) {
      lexicon.lookup(by, 'كتب');
      lexicon.lookup(by, 'كِتاب', { fold: true, features: ['gloss'] });
    }
    lexicon.byRoot(ROOT_KTB);
    lexicon.byLemma('أَمَل', { fold: true });
    Array.from(lexicon.entries());
    expect(memoCount(entryMemoOf(db.stems))).toBe(0);
    expect(entryMemoOf(db.lemmaHash)).toBe(entryMemoOf(db.stems));
    expect(entryMemoOf(db.prefixCatHash)).toBe(entryMemoOf(db.stems));
  });

  it('byStem returns the entries of a surface in line order, equal to the View', () => {
    const lexicon = new Lexicon(parse());
    const expected = viewEntries(parse(), (surface) => surface === 'كتب');
    const got = lexicon.byStem('كتب');
    expect(got.map((r) => r.category)).toEqual(['N1', 'V0']);
    expect(plain(got)).toEqual(expected);
    expect(plain(lexicon.lookup('stem', 'كتب'))).toEqual(expected);
  });

  it('byLemma matches the stored, stripped lex', () => {
    const lexicon = new Lexicon(parse());
    const got = lexicon.byLemma('كِتاب');
    expect(got.map((r) => r.surface)).toEqual(['كتاب', 'كتب']);
    expect(plain(got)).toEqual(viewEntries(parse(), (_s, e) => e.features['lex'] === 'كِتاب'));
    expect(lexicon.byLemma('كِتاب_1')).toEqual([]);
  });

  it('byRoot matches the root feature and never returns an entry without one', () => {
    const lexicon = new Lexicon(parse());
    const got = lexicon.byRoot(ROOT_KTB);
    expect(got.map((r) => r.surface)).toEqual(['كتاب', 'كتب', 'مكتبة', 'كتب']);
    expect(plain(got)).toEqual(viewEntries(parse(), (_s, e) => e.features['root'] === ROOT_KTB));
    for (const record of lexicon.entries()) {
      if (record.features['root'] === undefined) {
        expect(record.surface).toBe('مكتبه');
      }
    }
  });

  it('returns records whose features are in Layout order, fresh and frozen', () => {
    const lexicon = new Lexicon(parse());
    const [first] = lexicon.byStem('كتاب');
    const [again] = lexicon.byStem('كتاب');
    const view = (parse().stems.get('كتاب') as readonly Entry[])[0] as Entry;
    expect(Object.entries(first!.features)).toEqual(Object.entries(view.features));
    expect(first).not.toBe(again);
    expect(first!.features).not.toBe(again!.features);
    expect(first).toEqual(again);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first!.features)).toBe(true);
  });

  it('keeps only the named features, in Layout order, ignoring names no entry has', () => {
    const lexicon = new Lexicon(parse());
    const [record] = lexicon.byStem('كتاب', { features: ['gloss', 'nothing', 'lex'] });
    expect(Object.keys(record!.features)).toEqual(['lex', 'gloss']);
    expect(record!.features).toEqual({ lex: 'كِتاب', gloss: 'ktab' });
    const [bare] = lexicon.byStem('كتاب', { features: [] });
    expect(bare!.features).toEqual({});
    const subset = Array.from(lexicon.entries({ features: ['root'] }));
    expect(subset.map((r) => Object.keys(r.features))).toEqual([
      ['root'], ['root'], ['root'], ['root'], [], ['root'], ['root'], ['root'],
    ]);
  });

  it('returns [] for an unknown key under every Lookup_Key, folded or not', () => {
    const lexicon = new Lexicon(parse());
    for (const by of ['lemma', 'stem', 'root'] as const) {
      expect(lexicon.lookup(by, 'zzz')).toEqual([]);
      expect(lexicon.lookup(by, '')).toEqual([]);
      expect(lexicon.lookup(by, 'zzz', { fold: true })).toEqual([]);
    }
  });

  it('throws TypeError for a non-string key, an unknown by or a bad features or fold option', () => {
    const lexicon = new Lexicon(parse());
    expect(() => lexicon.byStem(undefined as unknown as string)).toThrow(TypeError);
    expect(() => lexicon.byLemma(1 as unknown as string)).toThrow(TypeError);
    expect(() => lexicon.byRoot(null as unknown as string)).toThrow(TypeError);
    expect(() => lexicon.lookup('gloss' as LookupKey, 'ktab')).toThrow(TypeError);
    expect(() => lexicon.lookup('stem', 'كتب', { features: 'gloss' as unknown as string[] })).toThrow(TypeError);
    expect(() => lexicon.lookup('stem', 'كتب', { fold: 1 as unknown as boolean })).toThrow(TypeError);
    // entries() checks its options at the call, not on the first next().
    expect(() => lexicon.entries({ features: 'gloss' as unknown as string[] })).toThrow(TypeError);
  });

  it('yields every entry in line order from entries(), and size is the stem count', () => {
    const lexicon = new Lexicon(parse());
    const all = Array.from(lexicon.entries());
    expect(lexicon.size).toBe(8);
    expect(all.length).toBe(lexicon.size);
    expect(all.map((r) => r.category)).toEqual(['N0', 'N1', 'N0', 'V0', 'N0', 'N0', 'A0', 'N1']);
    expect(plain(all)).toEqual(viewEntries(parse(), () => true));
    expect(all.map((r) => r.features['gloss'])).toEqual(['ktab', 'ktab', 'mktb', 'ktb', 'mktbh', 'aml', 'aml2', 'amal']);
  });

  it("reuses the model's stem index, and its lemma index under r; builds the others on the instance", () => {
    const db = parse();
    const model = tupleModelOf(db);
    const lexicon = new Lexicon(db);
    expect(model.stem.stemIndex).not.toBeNull();
    if (flags === 'r') {
      expect(model.stem.lemmaIndex).not.toBeNull();
    } else {
      expect(model.stem.lemmaIndex).toBeNull();
    }
    const before = { stem: model.stem.stemIndex, lemma: model.stem.lemmaIndex };
    const keys = { db: Object.keys(db), model: Object.keys(model), stem: Object.keys(model.stem) };
    lexicon.byLemma('كِتاب');
    lexicon.byRoot(ROOT_KTB);
    lexicon.byLemma('كتاب', { fold: true });
    expect(model.stem.stemIndex).toBe(before.stem);
    expect(model.stem.lemmaIndex).toBe(before.lemma);
    // Nothing is stored on the model.
    expect({ db: Object.keys(db), model: Object.keys(model), stem: Object.keys(model.stem) }).toEqual(keys);
    const priv = lexicon as unknown as Record<string, unknown>;
    expect(Object.keys(priv)).toEqual(['size']);
    // A built index and a folded index are kept, not rebuilt per call.
    const first = lexiconIndexesOf(lexicon);
    const root = first.root;
    const foldedLemma = first.folded.get('lemma');
    expect(root).not.toBeNull();
    expect(foldedLemma).toBeDefined();
    lexicon.byRoot(ROOT_AML_HAMZA);
    lexicon.byLemma('امل', { fold: true });
    const second = lexiconIndexesOf(lexicon);
    expect(second.root).toBe(root);
    expect(second.lemma).toBe(first.lemma);
    expect(second.folded.get('lemma')).toBe(foldedLemma);
  });
});

describe('Lexicon folded lookups', () => {
  const lexicon = (): Lexicon => new Lexicon(parseAlmor(DB, { flags: 'a' }));

  it('a bare spelling finds a diacritized lemma', () => {
    const lex = lexicon();
    expect(lex.byLemma('كتاب')).toEqual([]);
    const got = lex.byLemma('كتاب', { fold: true });
    expect(got.map((r) => r.features['lex'])).toEqual(['كِتاب', 'كِتاب']);
  });

  it('a teh-marbuta variant finds a stem, and the union is in line order', () => {
    const lex = lexicon();
    expect(lex.byStem('مكتبه', { fold: true }).map((r) => r.surface)).toEqual(['مكتبة', 'مكتبه']);
    expect(lex.byStem('مكتبة', { fold: true }).map((r) => r.surface)).toEqual(['مكتبة', 'مكتبه']);
  });

  it('folds roots and lemmas with alef variants on both sides', () => {
    const lex = lexicon();
    // The hamza key's slot holds lines 6 and 8, the bare key's line 7: the
    // union comes back in line order, not slot by slot.
    expect(lex.byRoot(ROOT_AML_BARE, { fold: true }).map((r) => r.category)).toEqual(['N0', 'A0', 'N1']);
    expect(lex.byLemma('إَمَل', { fold: true }).map((r) => r.category)).toEqual(['N0', 'A0', 'N1']);
    expect(lex.byLemma('أَمَل').map((r) => r.category)).toEqual(['N0', 'N1']);
  });

  it('the exact result is a subsequence of the folded one, and fold defaults to false', () => {
    const lex = lexicon();
    const keys: [LookupKey, string][] = [
      ['stem', 'مكتبه'], ['stem', 'كتب'], ['lemma', 'كِتاب'], ['lemma', 'أَمَل'], ['root', ROOT_AML_HAMZA], ['root', ROOT_KTB],
    ];
    for (const [by, key] of keys) {
      const exact = plain(lex.lookup(by, key));
      const folded = plain(lex.lookup(by, key, { fold: true }));
      expect(plain(lex.lookup(by, key, {}))).toEqual(exact);
      expect(plain(lex.lookup(by, key, { fold: false }))).toEqual(exact);
      let i = 0;
      for (const item of folded) {
        if (i < exact.length && JSON.stringify(item) === JSON.stringify(exact[i])) i++;
      }
      expect(i).toBe(exact.length);
      expect(folded.length).toBeGreaterThanOrEqual(exact.length);
    }
  });
});

describe('Lexicon over a model without analysis', () => {
  it('refuses a g model with DatabaseError', () => {
    const db = parseAlmor(DB, { flags: 'g' });
    expect(() => new Lexicon(db)).toThrow(DatabaseError);
    expect(() => new Lexicon(db)).toThrow('DB does not support analysis');
  });
});

describe('entryMemoOf', () => {
  it('throws TypeError for a value that is not an entry or record View', () => {
    const db = parseAlmor(DB, { flags: 'a' });
    expect(() => entryMemoOf(db.prefixStemCompat)).toThrow(TypeError);
    expect(() => entryMemoOf({})).toThrow(TypeError);
  });

  it('returns the memo the Views fill as they are read', () => {
    const db = parseAlmor(DB, { flags: 'a' });
    const memo = entryMemoOf(db.stems);
    expect(memoCount(memo)).toBe(0);
    db.stems.get('كتب');
    expect(memoCount(memo)).toBe(2);
  });
});
