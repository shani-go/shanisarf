// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The TypeScript half of the Canonical_Key checked against the shared,
// committed vector. The Python half is checked against the same vector by the
// parity harness, so a drift between the two serializers fails here.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { type Analysis, canonicalKey, canonicalOrder } from './canonical';

interface Vector {
  name: string;
  analysis: Analysis;
  canonicalKey: string;
}

interface VectorFile {
  schema: string;
  note: string;
  vectors: Vector[];
}

const vectorPath = fileURLToPath(
  new URL('../../fixtures/meta/canonical-vector.json', import.meta.url),
);
const vectorFile = JSON.parse(readFileSync(vectorPath, 'utf8')) as VectorFile;

describe('canonicalKey matches the committed shared vector', () => {
  it('has vectors to check', () => {
    expect(vectorFile.vectors.length).toBeGreaterThan(0);
  });

  for (const vector of vectorFile.vectors) {
    it(`serializes "${vector.name}" to the expected Canonical_Key`, () => {
      expect(canonicalKey(vector.analysis)).toBe(vector.canonicalKey);
    });
  }
});

describe('canonicalKey serialization rules', () => {
  it('sorts keys by UTF-16 code unit', () => {
    expect(canonicalKey({ c: '3', a: '1', b: '2' })).toBe(
      '{"a":"1","b":"2","c":"3"}',
    );
  });

  it('uses compact separators with no whitespace', () => {
    expect(canonicalKey({ a: '1', b: '2' })).toBe('{"a":"1","b":"2"}');
  });

  it('leaves non-ASCII unescaped', () => {
    expect(canonicalKey({ diac: 'كَتَبَ' })).toBe('{"diac":"كَتَبَ"}');
  });

  it('prints an integral number without a fractional part', () => {
    expect(canonicalKey({ lex_logprob: -99 })).toBe('{"lex_logprob":-99}');
  });

  it('keeps a non-integral number as its shortest round-trip form', () => {
    expect(canonicalKey({ lex_logprob: -6.71828 })).toBe(
      '{"lex_logprob":-6.71828}',
    );
  });

  it('serializes null as null', () => {
    expect(canonicalKey({ stemcat: null })).toBe('{"stemcat":null}');
  });

  it('serializes the empty analysis as an empty object', () => {
    expect(canonicalKey({})).toBe('{}');
  });
});

describe('canonicalOrder', () => {
  it('sorts analyses by their Canonical_Key', () => {
    const a: Analysis = { diac: 'b' };
    const b: Analysis = { diac: 'a' };
    const c: Analysis = { diac: 'c' };
    const ordered = canonicalOrder([a, b, c]);
    expect(ordered.map((x) => x['diac'])).toEqual(['a', 'b', 'c']);
  });

  it('keeps duplicates (a multiset, not a set)', () => {
    const a: Analysis = { diac: 'x' };
    const dup: Analysis = { diac: 'x' };
    const b: Analysis = { diac: 'a' };
    const ordered = canonicalOrder([a, dup, b]);
    expect(ordered.length).toBe(3);
    expect(ordered.map((x) => x['diac'])).toEqual(['a', 'x', 'x']);
  });

  it('does not mutate its input', () => {
    const input: Analysis[] = [{ diac: 'b' }, { diac: 'a' }];
    const snapshot = input.map((x) => x['diac']);
    canonicalOrder(input);
    expect(input.map((x) => x['diac'])).toEqual(snapshot);
  });

  it('is a total order: equal keys compare equal and sorting is stable', () => {
    const items: Analysis[] = [
      { k: '2' },
      { k: '1' },
      { k: '2' },
      { k: '1' },
    ];
    const ordered = canonicalOrder(items);
    expect(ordered.map((x) => x['k'])).toEqual(['1', '1', '2', '2']);
  });
});
