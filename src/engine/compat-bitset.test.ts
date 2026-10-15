// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for category roles, Compatibility_Bitsets and ordered pair lists.
// Category names are invented.
import { describe, expect, it } from 'vitest';

import { bitsetHas, CategoryRoleBuilder, PairTableBuilder } from './compat-bitset.js';

describe('CategoryRoleBuilder', () => {
  it('assigns role ids in first-seen order, taking names exactly as given', () => {
    const role = new CategoryRoleBuilder();
    const nameIds: string[] = [];
    const nameId = (name: string) => nameIds.push(name) - 1;
    expect([role.roleId('PRE', nameId), role.roleId('PRE ', nameId), role.roleId('PRE', nameId)]).toEqual([0, 1, 0]);
    const finished = role.finish(Int32Array.from([5, 6]));
    expect([...finished.names]).toEqual([5, 6]);
    expect([...finished.ids]).toEqual([['PRE', 0], ['PRE ', 1]]);
  });
});

describe('PairTableBuilder', () => {
  it('keeps distinct pairs in line order under rows in first-seen order, with a matching bitset', () => {
    const t = new PairTableBuilder();
    t.add(2, 1);
    t.add(0, 3);
    t.add(2, 0);
    t.add(2, 1); // a repeat changes nothing
    t.add(0, 3);
    const { bitset, order } = t.finish(4, 40);
    expect([...order.rows]).toEqual([2, 0]);
    expect([...order.rowOf]).toEqual([1, -1, 0, -1]);
    const row = (r: number) => [...order.ids.subarray(order.start[r], order.start[r + 1])];
    expect([row(0), row(1)]).toEqual([[1, 0], [3]]);
    expect(bitset.words).toBe(2);
    expect([bitsetHas(bitset, 2, 1), bitsetHas(bitset, 2, 0), bitsetHas(bitset, 0, 3)]).toEqual([true, true, true]);
    expect([bitsetHas(bitset, 0, 1), bitsetHas(bitset, 1, 3), bitsetHas(bitset, 3, 0)]).toEqual([false, false, false]);
  });

  it('treats an absent row, and ids outside the matrix, as empty', () => {
    const t = new PairTableBuilder();
    t.add(0, 33);
    const { bitset } = t.finish(2, 34);
    expect(bitsetHas(bitset, 0, 33)).toBe(true);
    expect(bitsetHas(bitset, 1, 33)).toBe(false);
    expect(bitsetHas(bitset, 5, 0)).toBe(false);
    expect(bitsetHas(bitset, 0, 99)).toBe(false);
    expect(bitsetHas(bitset, -1, 0)).toBe(false);
  });

  it('builds an empty table', () => {
    const { bitset, order } = new PairTableBuilder().finish(0, 0);
    expect(bitset.bits.length).toBe(0);
    expect(order.rows.length).toBe(0);
    expect([...order.start]).toEqual([0]);
  });
});
