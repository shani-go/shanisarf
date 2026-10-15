// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for `serializeAlmor`. The core test is the parse round trip:
// parse a synthetic ALMOR document, serialize the model, re-parse the emission,
// and assert the two models are equal, `defines` values compared as sets (only
// membership survives) and every other structure compared exactly.
import { describe, expect, it } from 'vitest';

import { parseAlmor } from './almor-parser.js';
import { DatabaseError } from './errors.js';
import { serializeAlmor } from './almor-serializer.js';
import type { MorphologyDb } from './database.js';

/**
 * A synthetic ALMOR document that exercises every section with more than one
 * row where it matters: multiple defines (an open class among them), two
 * defaults rows (one with a `*` value, the `pos:*` row), a multi-feature
 * order, several tokenizations, two stem-backoff actions, multiple affix and
 * stem surfaces with repeated surfaces, feature values holding a colon, and
 * compatibility tables with a left category mapping to several right ones.
 */
function syntheticDoc(): string {
  const order = [
    'DEFINES',
    'DEFAULTS',
    'ORDER',
    'TOKENIZATIONS',
    'STEMBACKOFF',
    'PREFIXES',
    'SUFFIXES',
    'STEMS',
    'TABLE AB',
    'TABLE BC',
    'TABLE AC',
  ];
  const sections: Record<string, string[]> = {
    DEFINES: [
      'DEFINE pos pos:noun pos:verb pos:prep',
      'DEFINE gen gen:m gen:f',
      'DEFINE num num:s num:d num:p',
      'DEFINE prc0 prc0:*open*',
      'DEFINE lex lex:*open*',
      'DEFINE diac diac:*open*',
      'DEFINE bw bw:*open*',
      'DEFINE caphi caphi:*open*',
    ],
    DEFAULTS: [
      'DEFAULT pos:noun gen:m num:s prc0:*',
      'DEFAULT pos:verb gen:m num:s',
      'DEFAULT pos:*',
    ],
    ORDER: ['ORDER pos gen num'],
    TOKENIZATIONS: ['TOKENIZATION pos gen'],
    STEMBACKOFF: [
      'STEMBACKOFF ALL NOUN VERB PREP',
      'STEMBACKOFF PROP NOUN_PROP',
    ],
    PREFIXES: [
      'wa\tPref-0\tdiac:wa pos:prep',
      'wa\tPref-1\tdiac:wa pos:noun',
      'bi\tPref-2\tdiac:bi pos:prep',
      '\tPref-3\tdiac:0 pos:noun',
    ],
    SUFFIXES: [
      'hu\tSuff-0\tdiac:hu pos:noun gen:m',
      'ha\tSuff-1\tdiac:ha pos:noun gen:f',
    ],
    STEMS: [
      'ktb\tStem-0\tdiac:kataba lex:katab_1 pos:verb caphi:k_a_t_a_b_a',
      'ktb\tStem-1\tdiac:kutub lex:kitab-u pos:noun',
      'drs\tStem-2\tdiac:darasa lex:daras_1 pos:verb bw:a:b',
    ],
    'TABLE AB': ['Pref-0 Stem-2', 'Pref-1 Stem-0', 'Pref-1 Stem-1'],
    'TABLE BC': ['Stem-0 Suff-0', 'Stem-1 Suff-0', 'Stem-1 Suff-1'],
    'TABLE AC': ['Pref-0 Suff-0', 'Pref-1 Suff-0', 'Pref-1 Suff-1'],
  };

  const lines: string[] = [];
  for (const name of order) {
    lines.push(`###${name}###`);
    lines.push(...(sections[name] as string[]));
  }
  return lines.join('\n') + '\n';
}

/**
 * Assert two models are equal under the round-trip rule: `defines` values
 * compared as sets, every other field compared exactly. `null` open-class
 * values stay `null` on both sides.
 */
function expectModelsEqual(a: MorphologyDb, b: MorphologyDb): void {
  // defines: same names, each value compared as a set (null stays null).
  expect([...a.defines.keys()]).toEqual([...b.defines.keys()]);
  for (const [name, aVals] of a.defines) {
    const bVals = b.defines.get(name);
    if (aVals === null || bVals === null) {
      expect(aVals).toBe(bVals);
    } else {
      expect(new Set(aVals)).toEqual(new Set(bVals));
    }
  }

  // Everything else exactly.
  expect(a.flags).toEqual(b.flags);
  expect(a.defaults).toEqual(b.defaults);
  expect(a.order).toEqual(b.order);
  expect(a.tokenizations).toEqual(b.tokenizations);
  expect(a.computeFeats).toEqual(b.computeFeats);
  expect(a.stemBackoffs).toEqual(b.stemBackoffs);
  expect(a.prefixes).toEqual(b.prefixes);
  expect(a.suffixes).toEqual(b.suffixes);
  expect(a.stems).toEqual(b.stems);
  expect(a.prefixStemCompat).toEqual(b.prefixStemCompat);
  expect(a.stemSuffixCompat).toEqual(b.stemSuffixCompat);
  expect(a.prefixSuffixCompat).toEqual(b.prefixSuffixCompat);
  expect(a.maxPrefixSize).toBe(b.maxPrefixSize);
  expect(a.maxSuffixSize).toBe(b.maxSuffixSize);
}

describe('serializeAlmor: round trip', () => {
  it('parse → serialize → parse yields an equal model', () => {
    const original = parseAlmor(syntheticDoc());
    const reparsed = parseAlmor(serializeAlmor(original));
    expectModelsEqual(original, reparsed);
  });

  it('is idempotent on the serialized text', () => {
    const original = parseAlmor(syntheticDoc());
    const once = serializeAlmor(original);
    const twice = serializeAlmor(parseAlmor(once));
    // The emission is deterministic, so a second round produces the same text.
    expect(twice).toBe(once);
  });

  it('round-trips an open-class define as *open* (null preserved)', () => {
    const original = parseAlmor(syntheticDoc());
    const reparsed = parseAlmor(serializeAlmor(original));
    expect(reparsed.defines.get('lex')).toBeNull();
    expect(reparsed.defines.get('prc0')).toBeNull();
  });

  it('round-trips a null default value through *', () => {
    const original = parseAlmor(syntheticDoc());
    const reparsed = parseAlmor(serializeAlmor(original));
    // prc0:* in the noun default parsed to null; it must stay null.
    expect(reparsed.defaults.get('noun')?.['prc0']).toBeNull();
    // The pos:* row's key is null and its pos value is null.
    expect(reparsed.defaults.get(null)).toEqual({ pos: null });
  });

  it('round-trips a feature value containing a colon', () => {
    const original = parseAlmor(syntheticDoc());
    const reparsed = parseAlmor(serializeAlmor(original));
    expect(reparsed.stems.get('drs')?.[0]?.features['bw']).toBe('a:b');
  });

  it('round-trips repeated surfaces with multiple entries', () => {
    const original = parseAlmor(syntheticDoc());
    const reparsed = parseAlmor(serializeAlmor(original));
    expect(reparsed.prefixes.get('wa')).toHaveLength(2);
    expect(reparsed.stems.get('ktb')).toHaveLength(2);
  });

  it('round-trips an empty prefix surface', () => {
    const original = parseAlmor(syntheticDoc());
    const reparsed = parseAlmor(serializeAlmor(original));
    expect(reparsed.prefixes.has('')).toBe(true);
  });

  it('preserves the affix size bounds', () => {
    const original = parseAlmor(syntheticDoc());
    const reparsed = parseAlmor(serializeAlmor(original));
    expect(reparsed.maxPrefixSize).toBe(original.maxPrefixSize);
    expect(reparsed.maxSuffixSize).toBe(original.maxSuffixSize);
  });
});

describe('serializeAlmor: section structure', () => {
  it('emits the eleven markers in order', () => {
    const text = serializeAlmor(parseAlmor(syntheticDoc()));
    const markers = [
      '###DEFINES###',
      '###DEFAULTS###',
      '###ORDER###',
      '###TOKENIZATIONS###',
      '###STEMBACKOFF###',
      '###PREFIXES###',
      '###SUFFIXES###',
      '###STEMS###',
      '###TABLE AB###',
      '###TABLE BC###',
      '###TABLE AC###',
    ];
    const positions = markers.map((m) => text.indexOf(m));
    // Every marker is present and they appear in strictly increasing order.
    for (const pos of positions) {
      expect(pos).toBeGreaterThanOrEqual(0);
    }
    for (let k = 1; k < positions.length; k++) {
      expect(positions[k]).toBeGreaterThan(positions[k - 1] as number);
    }
  });

  it('omits the ORDER line when order is null', () => {
    // A document with no ORDER section leaves order null; serialize must emit
    // the marker with no ORDER line, and the round trip keeps order null.
    const noOrder = parseAlmor(buildWithoutOrder());
    expect(noOrder.order).toBeNull();
    const reparsed = parseAlmor(serializeAlmor(noOrder));
    expect(reparsed.order).toBeNull();
  });
});

/**
 * A minimal document whose ORDER section is empty (marker immediately followed
 * by TOKENIZATIONS), so `order` stays null after parsing. TOKENIZATIONS is
 * likewise empty because its features would have to be defined and the empty
 * ORDER leaves `computeFeats` empty.
 */
function buildWithoutOrder(): string {
  const lines = [
    '###DEFINES###',
    'DEFINE pos pos:noun',
    'DEFINE lex lex:*open*',
    'DEFINE diac diac:*open*',
    '###DEFAULTS###',
    'DEFAULT pos:noun',
    'DEFAULT pos:*',
    '###ORDER###',
    '###TOKENIZATIONS###',
    '###STEMBACKOFF###',
    'STEMBACKOFF ALL NOUN',
    '###PREFIXES###',
    'wa\tPref-0\tdiac:wa pos:noun',
    '###SUFFIXES###',
    'hu\tSuff-0\tdiac:hu pos:noun',
    '###STEMS###',
    'ktb\tStem-0\tdiac:kataba lex:katab_1 pos:noun',
    '###TABLE AB###',
    'Pref-0 Stem-0',
    '###TABLE BC###',
    'Stem-0 Suff-0',
    '###TABLE AC###',
    'Pref-0 Suff-0',
  ];
  return lines.join('\n') + '\n';
}

// The generation side of the round trip.
describe('serializeAlmor: generation side', () => {
  // Two lemmas whose stem lines interleave two surfaces: emitting surface by
  // surface would put `kutub` before `kitAb` and reverse the `kitAb` lemma's
  // list, so this exercises the order-keeping emission. Pref-1 and Pref-0
  // interleave the same way across the prefix surfaces.
  const doc = [
    '###DEFINES###',
    'DEFINE pos pos:noun pos:verb',
    'DEFINE lex lex:*open*',
    'DEFINE diac diac:*open*',
    '###DEFAULTS###',
    'DEFAULT pos:noun',
    '###ORDER###',
    'ORDER pos',
    '###TOKENIZATIONS###',
    'TOKENIZATION pos',
    '###STEMBACKOFF###',
    'STEMBACKOFF ALL Stem-0',
    '###PREFIXES###',
    'wa\tPref-1\tdiac:wa',
    'fa\tPref-0\tdiac:fa',
    'wa\tPref-0\tdiac:wa2',
    '###SUFFIXES###',
    'hu\tSuff-0\tdiac:hu',
    '###STEMS###',
    'ktb\tStem-0\tdiac:kataba lex:katab_1 pos:verb',
    'ktAb\tStem-1\tdiac:kitAb lex:kitAb_1 pos:noun',
    'ktb\tStem-1\tdiac:kutub lex:kitAb_2 pos:noun',
    '###TABLE AB###',
    'Pref-0 Stem-0',
    'Pref-1 Stem-1',
    '###TABLE BC###',
    'Stem-0 Suff-0',
    '###TABLE AC###',
    'Pref-0 Suff-0',
    '',
  ].join('\n');

  it('an r model round-trips with its generation tables in list order', () => {
    const original = parseAlmor(doc, { flags: 'r' });
    const reparsed = parseAlmor(serializeAlmor(original), { flags: 'r' });
    expectModelsEqual(original, reparsed);
    expect(reparsed.prefixCatHash).toEqual(original.prefixCatHash);
    expect(reparsed.suffixCatHash).toEqual(original.suffixCatHash);
    expect(reparsed.lemmaHash).toEqual(original.lemmaHash);
    expect(reparsed.stemPrefixCompat).toEqual(original.stemPrefixCompat);
    expect(reparsed.lemmaHash.get('kitAb')?.map((e) => e.features['diac'])).toEqual([
      'kitAb',
      'kutub',
    ]);
    expect(reparsed.prefixCatHash.get('Pref-0')?.map((f) => f['diac'])).toEqual([
      'fa',
      'wa2',
    ]);
  });

  it('refuses a model parsed without the analysis flag', () => {
    const g = parseAlmor(doc, { flags: 'g' });
    expect(() => serializeAlmor(g)).toThrow(DatabaseError);
  });
});
