// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Model comparison: two models equal (Maps and Sets in order, entries by
// category and ordered features, header fields), and the engine's
// entry-sharing invariant through its Views.

import type { MorphologyDb } from '../../src/engine/index.js';

/** The fields every model has, read the same way from either side. */
export type AnyDb = Pick<
  MorphologyDb,
  | 'flags'
  | 'defines'
  | 'defaults'
  | 'order'
  | 'tokenizations'
  | 'computeFeats'
  | 'stemBackoffs'
  | 'prefixes'
  | 'suffixes'
  | 'stems'
  | 'lemmaHash'
  | 'prefixCatHash'
  | 'suffixCatHash'
  | 'prefixStemCompat'
  | 'stemSuffixCompat'
  | 'prefixSuffixCompat'
  | 'stemPrefixCompat'
  | 'maxPrefixSize'
  | 'maxSuffixSize'
>;

/** At most this many differences are kept for a failure message. */
const MAX_REPORTED = 8;

/**
 * Every difference between two models: Maps and Sets
 * in order, entries by category and ordered features. With `definesAsSets`,
 * a define's values compare as a set (the serializer's round trip).
 */
export function modelDifferences(a: AnyDb, b: AnyDb, definesAsSets = false): string[] {
  const out: string[] = [];
  const note = (what: string): void => {
    if (out.length < MAX_REPORTED) {
      out.push(what);
    }
  };
  const same = (what: string, x: unknown, y: unknown): void => {
    const jx = JSON.stringify(x);
    const jy = JSON.stringify(y);
    if (jx !== jy) {
      note(`${what}: ${jx.slice(0, 200)} vs ${jy.slice(0, 200)}`);
    }
  };

  same('flags', a.flags, b.flags);
  same('maxPrefixSize', a.maxPrefixSize, b.maxPrefixSize);
  same('maxSuffixSize', a.maxSuffixSize, b.maxSuffixSize);
  const defines = (db: AnyDb) =>
    [...db.defines].map(([k, v]) => [k, v === null ? null : definesAsSets ? [...v].sort() : [...v]]);
  same('defines', defines(a), defines(b));
  same('defaults', [...a.defaults].map(([k, v]) => [k, Object.entries(v)]), [...b.defaults].map(([k, v]) => [k, Object.entries(v)]));
  same('order', a.order, b.order);
  same('tokenizations', [...a.tokenizations], [...b.tokenizations]);
  same('computeFeats', [...a.computeFeats], [...b.computeFeats]);
  same('stemBackoffs', [...a.stemBackoffs], [...b.stemBackoffs]);

  const entryMaps = ['prefixes', 'suffixes', 'stems', 'lemmaHash'] as const;
  for (const field of entryMaps) {
    const ma = a[field];
    const mb = b[field];
    same(`${field} keys`, [...ma.keys()], [...mb.keys()]);
    for (const [key, ea] of ma) {
      const eb = mb.get(key) ?? [];
      if (ea.length !== eb.length) {
        note(`${field}[${key}]: ${ea.length} entries vs ${eb.length}`);
        continue;
      }
      ea.forEach((entry, i) => {
        const other = eb[i]!;
        if (entry.category !== other.category) {
          note(`${field}[${key}][${i}].category: ${entry.category} vs ${other.category}`);
        }
        same(`${field}[${key}][${i}].features`, Object.entries(entry.features), Object.entries(other.features));
      });
    }
  }
  for (const field of ['prefixCatHash', 'suffixCatHash'] as const) {
    same(
      field,
      [...a[field]].map(([k, records]) => [k, records.map((r) => Object.entries(r))]),
      [...b[field]].map(([k, records]) => [k, records.map((r) => Object.entries(r))]),
    );
  }
  for (const field of ['prefixStemCompat', 'stemSuffixCompat', 'prefixSuffixCompat', 'stemPrefixCompat'] as const) {
    same(field, [...a[field]].map(([k, v]) => [k, [...v]]), [...b[field]].map(([k, v]) => [k, [...v]]));
  }
  return out;
}

/** The engine's sharing invariant, through its Views: one object per entry. */
export function sharingDifferences(db: MorphologyDb): string[] {
  const out: string[] = [];
  const featuresOf = (map: ReadonlyMap<string, readonly { readonly features: object }[]>) =>
    new Set([...map.values()].flat().map((e) => e.features));
  if (db.flags.analysis && db.flags.generation) {
    for (const [records, entries, side] of [
      [db.prefixCatHash, db.prefixes, 'prefix'],
      [db.suffixCatHash, db.suffixes, 'suffix'],
    ] as const) {
      const held = featuresOf(entries);
      const all = [...records.values()].flat();
      if (all.length !== held.size || !all.every((r) => held.has(r))) {
        out.push(`${side} records are not the entries' features`);
      }
    }
    const stems = new Set([...db.stems.values()].flat());
    const lemmaEntries = [...db.lemmaHash.values()].flat();
    if (lemmaEntries.length !== stems.size || !lemmaEntries.every((e) => stems.has(e))) {
      out.push('lemmaHash entries are not the stems entries');
    }
  }
  return out;
}
