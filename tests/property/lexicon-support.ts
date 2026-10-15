// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Shared support for the lexicon-equals-views and key-fold properties:
// `lexiconDoc`, an `almorDoc` text whose stem lines also carry a `root` (on
// some lines) and whose `lex` values may carry a diacritic and a `_N` suffix,
// so the three Lookup_Keys and the Fold all have something to collide on; the
// View's stem entries put back in line order; the EntryMemo's size; and the
// KeyIndex shape check. Words come from the engine's own character sets.

import fc from 'fast-check';

import type { Entry, MorphologyDb } from '../../src/engine/database.js';
import type { KeyIndex } from '../../src/engine/feature-schema.js';
import type { LexiconEntry, LookupKey } from '../../src/engine/lexicon.js';
import type { EntryMemo } from '../../src/engine/model-views.js';

import { almorDoc } from './arbitraries';

export const LOOKUP_KEYS: readonly LookupKey[] = ['lemma', 'stem', 'root'];

/** A record as plain data: `[surface, category, Object.entries(features)]`. */
export type Plain = [string, string, [string, string][]];

export function plainOf(r: LexiconEntry): Plain {
  return [r.surface, r.category, Object.entries(r.features)];
}

/** The value a Lookup_Key reads from a record, or undefined when it has none. */
export function keyOf(by: LookupKey, r: { surface: string; features: Readonly<Record<string, string>> }): string | undefined {
  if (by === 'stem') return r.surface;
  return r.features[by === 'lemma' ? 'lex' : 'root'];
}

// Root letters: bare and hamzated alefs (which fold together) and one other
// letter, so a few lines share a root exactly or only after the Fold.
const ROOT_LETTER = fc.constantFrom('ا', 'أ', 'إ', 'ب');
const MARK = fc.constantFrom('', '', 'َ', 'ِ', 'ّ');

const rootValue: fc.Arbitrary<string> = fc
  .array(fc.tuple(ROOT_LETTER, MARK), { minLength: 2, maxLength: 3 })
  .map((parts) => parts.map(([l, m]) => l + m).join('.'));

interface LineExtra {
  root: string | null;
  lexMark: string;
  lexSuffix: string;
}

const lineExtra: fc.Arbitrary<LineExtra> = fc.record({
  root: fc.option(rootValue, { freq: 3, nil: null }),
  lexMark: MARK,
  lexSuffix: fc.constantFrom('', '', '_1', '_2'),
});

/**
 * An `almorDoc` text with `DEFINE root root:*open*`, a `root` on some stem
 * lines, and a `lex` that may carry a mark after its first letter and a
 * `_N` suffix (which the parser strips).
 */
export const lexiconDoc: fc.Arbitrary<string> = fc
  .tuple(almorDoc, fc.array(lineExtra, { minLength: 4, maxLength: 4 }))
  .map(([text, extras]) => {
    const lines = text.split('\n');
    const out: string[] = [];
    let section = '';
    let k = 0;
    for (const line of lines) {
      if (line.startsWith('###')) {
        section = line;
        out.push(line);
        if (line === '###DEFINES###') out.push('DEFINE root root:*open*');
        continue;
      }
      if (section === '###STEMS###' && line !== '') {
        const extra = extras[k++ % extras.length] as LineExtra;
        let rewritten = line.replace(/lex:([^ ]+)/u, (_m, lex: string) => {
          const cps = [...lex];
          return `lex:${cps[0] ?? ''}${extra.lexMark}${cps.slice(1).join('')}${extra.lexSuffix}`;
        });
        if (extra.root !== null) rewritten += ` root:${extra.root}`;
        out.push(rewritten);
        continue;
      }
      out.push(line);
    }
    return out.join('\n');
  });

/**
 * The View's stem entries in line order, as plain records with their keys.
 * The View walks surfaces in first-seen order, so each stem line of `text`
 * takes the next unused View entry of its surface (the View keeps a
 * surface's entries in line order). Reads the Views: call it on a model
 * other than the one under test.
 */
export function viewLines(view: MorphologyDb, text: string): { plain: Plain; surface: string; features: Readonly<Record<string, string>> }[] {
  const all = text.split('\n');
  const stemLines = all.slice(all.indexOf('###STEMS###') + 1, all.indexOf('###TABLE AB###')).filter((l) => l !== '');
  const used = new Map<string, number>();
  const out: { plain: Plain; surface: string; features: Readonly<Record<string, string>> }[] = [];
  let total = 0;
  for (const entries of view.stems.values()) total += entries.length;
  if (total !== stemLines.length) {
    throw new Error(`the View holds ${total} stem entries for ${stemLines.length} stem lines`);
  }
  for (const line of stemLines) {
    const surface = line.split('\t')[0] as string;
    const n = used.get(surface) ?? 0;
    used.set(surface, n + 1);
    const entry = view.stems.get(surface)?.[n] as Entry | undefined;
    if (entry === undefined) {
      throw new Error(`no View entry ${n} for the stem surface ${JSON.stringify(surface)}`);
    }
    out.push({ plain: [surface, entry.category, Object.entries(entry.features)], surface, features: entry.features });
  }
  return out;
}

/** The number of entries an EntryMemo holds, over its three tables. */
export function memoCount(memo: EntryMemo): number {
  const tables = (memo as unknown as { memo: Record<string, (Entry | undefined)[]> }).memo;
  let n = 0;
  for (const list of Object.values(tables)) {
    for (const entry of list) {
      if (entry !== undefined) n++;
    }
  }
  return n;
}

/**
 * The ways `index` differs from a KeyIndexBuilder's shape: slots numbered
 * 0..n-1 in insertion order, `start` and `ids` Uint32Arrays with `start`
 * non-decreasing from 0 to `ids.length`, every slot non-empty, ids strictly
 * increasing within a slot (line order), keys in first-seen order (each
 * slot's first id above the previous slot's).
 */
export function keyIndexShapeErrors(index: KeyIndex): string[] {
  const errors: string[] = [];
  if (!(index.slots instanceof Map)) errors.push('slots is not a Map');
  if (!(index.start instanceof Uint32Array)) errors.push('start is not a Uint32Array');
  if (!(index.ids instanceof Uint32Array)) errors.push('ids is not a Uint32Array');
  const n = index.slots.size;
  let expected = 0;
  for (const [key, slot] of index.slots) {
    if (slot !== expected++) errors.push(`slot of ${JSON.stringify(key)} is ${slot}, not ${expected - 1}`);
  }
  if (index.start.length !== n + 1) errors.push(`start has ${index.start.length} items for ${n} slots`);
  if (index.start[0] !== 0) errors.push('start[0] is not 0');
  if (index.start[n] !== index.ids.length) errors.push('start[n] is not ids.length');
  let previousFirst = -1;
  for (let s = 0; s < n; s++) {
    const a = index.start[s] as number;
    const b = index.start[s + 1] as number;
    if (b <= a) errors.push(`slot ${s} is empty or start decreases`);
    for (let p = a + 1; p < b; p++) {
      if ((index.ids[p] as number) <= (index.ids[p - 1] as number)) errors.push(`slot ${s} ids not in line order`);
    }
    const first = index.ids[a] as number;
    if (first <= previousFirst) errors.push(`slot ${s} is not in first-seen order`);
    previousFirst = first;
  }
  return errors;
}
