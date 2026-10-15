// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The order of keys in a result object is part of the engine's output: a
// caller that iterates `Object.entries(analysis)` sees it, and the parity
// fixtures do not pin it (they compare in canonical order and by key set).
// These snapshots pin the key order of an analysis, a backoff analysis, a
// generated form and a reinflected form over the hand-made mini database.

import { describe, expect, it } from 'vitest';

import { parseAlmor } from './almor-parser.js';
import { Analyzer } from './analyzer.js';
import { Generator } from './generator.js';
import { Reinflector } from './reinflector.js';
import { MINI_DB } from '../../tests/support/generation-mini-db.js';

const db = parseAlmor(MINI_DB, { flags: 'r' });

// The mini database with one backoff stem, so the NOAN and ADD modes have a
// stem to substitute for an unknown word.
const BACKOFF_DB = MINI_DB.replace(
  '###TABLE AB###',
  'NOAN\tN0\tdiac:NOAN lex:NOAN_1 bw:NOAN/NOUN gloss:x pos:noun gen:m num:s rat:n stt:i\n###TABLE AB###',
);

function keysOf(results: Record<string, unknown>[]): string[][] {
  return results.map((r) => Object.keys(r));
}

describe('result key order', () => {
  it('lexical analysis', () => {
    const analyzer = new Analyzer(db);
    expect(keysOf(analyzer.analyze('كتاب'))).toMatchInlineSnapshot(`
      [
        [
          "diac",
          "lex",
          "pos",
          "gen",
          "num",
          "rat",
          "stt",
          "stem",
          "stemgloss",
          "stemcat",
        ],
      ]
    `);
    expect(keysOf(analyzer.analyze('الكتاب'))).toMatchInlineSnapshot(`
      [
        [
          "diac",
          "lex",
          "pos",
          "gen",
          "num",
          "rat",
          "stt",
          "stem",
          "stemgloss",
          "stemcat",
        ],
      ]
    `);
  });

  it('backoff analysis', () => {
    const backoffDb = parseAlmor(BACKOFF_DB, { flags: 'a' });
    for (const backoff of ['NOAN_ALL', 'ADD_ALL'] as const) {
      const keys = keysOf(new Analyzer(backoffDb, { backoff, normMap: null }).analyze('سمكة'));
      expect(keys.length, backoff).toBeGreaterThan(0);
      expect(new Set(keys.map((k) => k.join(','))).size, backoff).toBe(1);
    }
    expect(keysOf(new Analyzer(backoffDb, { backoff: 'NOAN_ALL', normMap: null }).analyze('سمكة'))[0]).toMatchInlineSnapshot(`
      [
        "diac",
        "lex",
        "bw",
        "gloss",
        "pos",
        "gen",
        "num",
        "rat",
        "stt",
        "caphi",
        "stem",
        "stemgloss",
        "stemcat",
        "source",
        "pattern",
      ]
    `);
  });

  it('generation', () => {
    expect(keysOf(new Generator(db).generate('كِتاب_1', { pos: 'noun', num: 'p' }))).toMatchInlineSnapshot(`
      [
        [
          "diac",
          "lex",
          "pos",
          "gen",
          "num",
          "stt",
          "stemcat",
          "stem",
          "stemgloss",
        ],
      ]
    `);
  });

  it('reinflection', () => {
    expect(keysOf(new Reinflector(db).reinflect('كتب', { num: 'p' }))).toMatchInlineSnapshot(`
      [
        [
          "diac",
          "lex",
          "pos",
          "gen",
          "num",
          "stt",
          "stemcat",
          "stem",
          "stemgloss",
        ],
      ]
    `);
  });
});
