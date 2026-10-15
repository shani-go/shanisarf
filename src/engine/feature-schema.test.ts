// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for Feature_Names, Layouts, entry tables and key indexes. Names
// and values are invented.
import { describe, expect, it } from 'vitest';

import {
  EntryTableBuilder,
  FeatureSchemaBuilder,
  idArray,
  idIndex,
  KeyIndexBuilder,
  MERGE_FEATURE_NAMES,
} from './feature-schema.js';

const IDENTITY = Int32Array.from({ length: 100 }, (_, i) => i);

describe('FeatureSchemaBuilder', () => {
  it('assigns Feature_Ids in first-seen order and appends the merge names not yet listed', () => {
    const b = new FeatureSchemaBuilder();
    expect([b.featureId('pos'), b.featureId('diac'), b.featureId('pos'), b.featureId('stem')]).toEqual([0, 1, 0, 2]);
    const schema = b.finish();
    expect(schema.names.slice(0, 3)).toEqual(['pos', 'diac', 'stem']);
    // Every merge name is listed once; `stem`, already present, keeps id 2.
    for (const name of MERGE_FEATURE_NAMES) {
      expect(schema.names.filter((n) => n === name)).toHaveLength(1);
    }
    expect(schema.ids.get('stem')).toBe(2);
    expect(schema.names.length).toBe(new Set(schema.names).size);
  });

  it('interns Layouts: the same key sequence shares an id, another order does not', () => {
    const b = new FeatureSchemaBuilder();
    expect(b.layoutId([0, 1, 2])).toBe(0);
    expect(b.layoutId([0, 1, 2])).toBe(0);
    expect(b.layoutId([1, 0, 2])).toBe(1);
    expect(b.layoutId([0, 1, 2])).toBe(0);
    expect(b.layoutCount).toBe(2);
  });
});

describe('EntryTableBuilder', () => {
  it('keeps a repeated key at its first position with its last value', () => {
    const s = new FeatureSchemaBuilder();
    const t = new EntryTableBuilder(s);
    const [a, b, c] = [s.featureId('a'), s.featureId('b'), s.featureId('c')];
    t.begin();
    t.token(a, 10);
    t.token(b, 11);
    t.token(a, 12); // repeated: position 0, value 12
    t.token(c, 13);
    expect(t.valueOf(a)).toBe(12);
    expect(t.valueOf(s.featureId('absent'))).toBe(-1);
    expect(t.end(0)).toBe(0);
    t.begin();
    t.token(c, 20);
    t.token(a, 21);
    expect(t.end(1)).toBe(1);
    const schema = s.finish();
    const table = t.finish(schema, IDENTITY, 2, false);
    expect(table.count).toBe(2);
    expect([...(schema.layouts[table.layout[0] as number] as Uint16Array)]).toEqual([a, b, c]);
    expect([...table.values.subarray(table.valueStart[0], table.valueStart[1])]).toEqual([12, 11, 13]);
    expect([...(schema.layouts[table.layout[1] as number] as Uint16Array)]).toEqual([c, a]);
    expect([...table.values.subarray(table.valueStart[1], table.valueStart[2])]).toEqual([20, 21]);
    expect([...table.category]).toEqual([0, 1]);
    expect(table.dense).toBeNull();
  });

  it('maps values through the remap and builds dense rows over the final Feature_Name list', () => {
    const s = new FeatureSchemaBuilder();
    const t = new EntryTableBuilder(s);
    const [x, y] = [s.featureId('x'), s.featureId('y')];
    t.begin();
    t.token(y, 1);
    t.end(0);
    t.begin();
    t.token(x, 0);
    t.token(y, 2);
    t.end(0);
    const schema = s.finish();
    const f = schema.names.length;
    const table = t.finish(schema, Int32Array.from([7, 8, 9]), 1, true);
    expect([...table.values]).toEqual([8, 7, 9]);
    const dense = table.dense as Int32Array;
    expect(dense.length).toBe(2 * f);
    expect([dense[x], dense[y]]).toEqual([-1, 8]);
    expect([dense[f + x], dense[f + y]]).toEqual([7, 9]);
    expect(dense[f + (schema.ids.get('stem') as number)]).toBe(-1);
  });
});

describe('array widths', () => {
  it('uses 16 bits when every id fits and 32 bits otherwise', () => {
    expect(idArray([1, 2, 65535], 65535)).toBeInstanceOf(Uint16Array);
    expect(idArray([1, 70000], 70000)).toBeInstanceOf(Uint32Array);
    expect([...idArray([1, 70000], 70000)]).toEqual([1, 70000]);
  });

  it('widens a table past 65,535 categories', () => {
    const s = new FeatureSchemaBuilder();
    const t = new EntryTableBuilder(s);
    t.begin();
    t.token(s.featureId('k'), 0);
    t.end(70000);
    const table = t.finish(s.finish(), IDENTITY, 70001, false);
    expect(table.category).toBeInstanceOf(Uint32Array);
    expect(table.category[0]).toBe(70000);
  });
});

describe('indexes', () => {
  it('a KeyIndex keeps slots in first-seen order and each slot\'s entries in line order', () => {
    const k = new KeyIndexBuilder();
    k.add('b', 0);
    k.add('a', 1);
    k.add('b', 2);
    k.add('c', 3);
    k.add('a', 4);
    const index = k.finish();
    expect([...index.slots]).toEqual([['b', 0], ['a', 1], ['c', 2]]);
    const slot = (s: number) => [...index.ids.subarray(index.start[s], index.start[s + 1])];
    expect([slot(0), slot(1), slot(2)]).toEqual([[0, 2], [1, 4], [3]]);
  });

  it('an IdIndex groups entries by dense slot, empty slots included', () => {
    const index = idIndex([2, 0, 2, 0], 4);
    const slot = (s: number) => [...index.ids.subarray(index.start[s], index.start[s + 1])];
    expect([slot(0), slot(1), slot(2), slot(3)]).toEqual([[1, 3], [], [0, 2], []]);
  });
});
