// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for `parseAlmor`. Each test uses a small synthetic ALMOR text,
// built from a minimal well-formed document with one section mutated, so a
// single section's rule or error is exercised in isolation. No real database
// is needed.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseAlmor, textLines } from './almor-parser.js';
import { DatabaseParseError, InvalidDatabaseFlagError } from './errors.js';
import { pyLines } from './python-compat.js';

/**
 * A minimal well-formed ALMOR document with every section present and one row
 * each. The affix/stem lines are tab-separated; everything else is
 * space-separated. Overriding `sections` replaces individual section bodies.
 */
function makeDoc(overrides: Partial<Record<string, string[]>> = {}): string {
  const sections: Record<string, string[]> = {
    DEFINES: [
      'DEFINE pos pos:noun pos:verb',
      'DEFINE gen gen:m gen:f',
      'DEFINE prc0 prc0:*open*',
      'DEFINE lex lex:*open*',
      'DEFINE diac diac:*open*',
      'DEFINE bw bw:*open*',
    ],
    DEFAULTS: ['DEFAULT pos:noun gen:m', 'DEFAULT pos:*'],
    ORDER: ['ORDER pos gen'],
    TOKENIZATIONS: ['TOKENIZATION pos'],
    STEMBACKOFF: ['STEMBACKOFF ALL NOUN VERB'],
    PREFIXES: ['wa\tPref-0\tdiac:wa pos:noun'],
    SUFFIXES: ['hu\tSuff-0\tdiac:hu pos:noun'],
    STEMS: ['ktb\tStem-0\tdiac:kataba lex:katab_1 pos:verb'],
    'TABLE AB': ['Pref-0 Stem-0'],
    'TABLE BC': ['Stem-0 Suff-0'],
    'TABLE AC': ['Pref-0 Suff-0'],
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) {
      sections[k] = v;
    }
  }

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
  const lines: string[] = [];
  for (const name of order) {
    lines.push(`###${name}###`);
    lines.push(...(sections[name] as string[]));
  }
  return lines.join('\n') + '\n';
}

describe('textLines', () => {
  it('splits exactly as pyLines does, without a RegExp', () => {
    const text = fc
      .array(fc.constantFrom('a', 'b', '\r', '\n', '\r\n', '\n\r', ' ', '\u2028'), { maxLength: 30 })
      .map((parts) => parts.join(''));
    fc.assert(
      fc.property(text, (s) => {
        expect(textLines(s)).toEqual(pyLines(s));
      }),
      { numRuns: 2000 },
    );
  });

  it('handles the edges: empty, a lone terminator, a final terminator', () => {
    for (const s of ['', '\n', '\r', '\r\n', 'a', 'a\n', 'a\r\n\r\nb', '\r\r\n']) {
      expect(textLines(s)).toEqual(pyLines(s));
    }
  });
});

describe('parseAlmor: flags', () => {
  it('defaults to analysis', () => {
    const db = parseAlmor(makeDoc());
    expect(db.flags).toEqual({
      analysis: true,
      generation: false,
      reinflection: false,
    });
  });

  // The flags 'g' and 'r' are accepted; an unknown character is still
  // refused.
  it('g sets generation only, and reinflection mirrors generation', () => {
    const db = parseAlmor(makeDoc(), { flags: 'g' });
    expect(db.flags).toEqual({
      analysis: false,
      generation: true,
      reinflection: true,
    });
  });

  it('r and ag set all three flags', () => {
    const all = { analysis: true, generation: true, reinflection: true };
    expect(parseAlmor(makeDoc(), { flags: 'r' }).flags).toEqual(all);
    expect(parseAlmor(makeDoc(), { flags: 'ag' }).flags).toEqual(all);
  });

  it('refuses an unknown flag character', () => {
    try {
      parseAlmor(makeDoc(), { flags: 'x' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidDatabaseFlagError);
      expect((err as InvalidDatabaseFlagError).flag).toBe('x');
    }
  });

  it('names the first bad character after valid ones', () => {
    try {
      parseAlmor(makeDoc(), { flags: 'agqz' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as InvalidDatabaseFlagError).flag).toBe('q');
      expect((err as Error).message).toBe("Invalid flag value 'q'");
    }
  });
});

describe('parseAlmor: generation tables', () => {
  const doc = makeDoc({
    PREFIXES: [
      'wa\tPref-0\tdiac:wa pos:noun',
      'fa\tPref-1\tdiac:fa',
      '\tPref-0\tdiac:',
    ],
    STEMS: [
      'ktb\tStem-0\tdiac:kataba lex:katab_1 pos:verb',
      'ktAb\tStem-1\tdiac:kitAb lex:kitAb_1 pos:noun',
      'ktb\tStem-1\tdiac:kutub lex:kitAb_2 pos:noun',
    ],
    'TABLE AB': ['Pref-0 Stem-0', 'Pref-1 Stem-0', 'Pref-0 Stem-1'],
  });

  it('r groups affix records by category, sharing the entry feature objects', () => {
    const db = parseAlmor(doc, { flags: 'r' });
    const pref0 = db.prefixCatHash.get('Pref-0') as Record<string, string>[];
    expect(pref0.map((f) => f['diac'])).toEqual(['wa', '']);
    expect(pref0[0]).toBe(db.prefixes.get('wa')?.[0]?.features);
    expect(pref0[1]).toBe(db.prefixes.get('')?.[0]?.features);
    expect(db.suffixCatHash.get('Suff-0')?.[0]).toBe(
      db.suffixes.get('hu')?.[0]?.features,
    );
  });

  it('r groups stem entries by stripped lex, sharing the Entry objects', () => {
    const db = parseAlmor(doc, { flags: 'r' });
    expect([...db.lemmaHash.keys()]).toEqual(['katab', 'kitAb']);
    const kitab = db.lemmaHash.get('kitAb') as unknown[];
    expect(kitab).toHaveLength(2);
    expect(kitab[0]).toBe(db.stems.get('ktAb')?.[0]);
    expect(kitab[1]).toBe(db.stems.get('ktb')?.[1]);
  });

  it('r transposes TABLE AB into stemPrefixCompat in line order', () => {
    const db = parseAlmor(doc, { flags: 'r' });
    expect([...db.stemPrefixCompat.entries()].map(([k, v]) => [k, [...v]])).toEqual([
      ['Stem-0', ['Pref-0', 'Pref-1']],
      ['Stem-1', ['Pref-0']],
    ]);
  });

  it('never writes stemcat into a stem entry', () => {
    const db = parseAlmor(doc, { flags: 'r' });
    for (const entries of db.lemmaHash.values()) {
      for (const entry of entries) {
        expect(Object.keys(entry.features)).not.toContain('stemcat');
      }
    }
  });

  it('g leaves the analysis side empty and still builds BC and AC', () => {
    const g = parseAlmor(doc, { flags: 'g' });
    const a = parseAlmor(doc, { flags: 'a' });
    expect(g.prefixes.size).toBe(0);
    expect(g.suffixes.size).toBe(0);
    expect(g.stems.size).toBe(0);
    expect(g.prefixStemCompat.size).toBe(0);
    expect(g.maxPrefixSize).toBe(0);
    expect(g.maxSuffixSize).toBe(0);
    // The tables are read-only Views: compare their contents, rows and members
    // in order.
    const rows = (t: ReadonlyMap<string, ReadonlySet<string>>) => [...t].map(([k, v]) => [k, [...v]]);
    expect(rows(g.stemSuffixCompat)).toEqual(rows(a.stemSuffixCompat));
    expect(rows(g.prefixSuffixCompat)).toEqual(rows(a.prefixSuffixCompat));
    expect(g.lemmaHash.get('kitAb')).toHaveLength(2);
  });

  it('a leaves the generation side empty', () => {
    const a = parseAlmor(doc, { flags: 'a' });
    expect(a.prefixCatHash.size).toBe(0);
    expect(a.suffixCatHash.size).toBe(0);
    expect(a.lemmaHash.size).toBe(0);
    expect(a.stemPrefixCompat.size).toBe(0);
  });
});

describe('parseAlmor: DEFINES', () => {
  it('keeps values in first-seen order and marks open classes null', () => {
    const db = parseAlmor(makeDoc());
    expect(db.defines.get('pos')).toEqual(['noun', 'verb']);
    expect(db.defines.get('gen')).toEqual(['m', 'f']);
    expect(db.defines.get('prc0')).toBeNull();
  });

  it('allFeats returns every define name', () => {
    const db = parseAlmor(makeDoc());
    expect(db.allFeats()).toEqual(
      new Set(['pos', 'gen', 'prc0', 'lex', 'diac', 'bw']),
    );
  });

  it('rejects a line with fewer than three tokens', () => {
    expect(() => parseAlmor(makeDoc({ DEFINES: ['DEFINE pos'] }))).toThrow(
      DatabaseParseError,
    );
  });

  it('rejects a line that does not start with DEFINE', () => {
    expect(() =>
      parseAlmor(makeDoc({ DEFINES: ['DEFIN pos pos:noun'] })),
    ).toThrow(DatabaseParseError);
  });

  it('rejects a malformed value token whose key is not the define name', () => {
    // `other` has one colon-part and is not the define name `pos`.
    expect(() =>
      parseAlmor(makeDoc({ DEFINES: ['DEFINE pos pos:noun other'] })),
    ).toThrow(DatabaseParseError);
  });

  it('treats *open* on a longer line as an ordinary value (upstream quirk)', () => {
    const db = parseAlmor(
      makeDoc({ DEFINES: ['DEFINE pos pos:noun pos:*open*', 'DEFINE lex lex:*open*', 'DEFINE diac diac:*open*', 'DEFINE bw bw:*open*'] }),
    );
    // Four tokens, so `*open*` is a value rather than an open-class marker.
    expect(db.defines.get('pos')).toEqual(['noun', '*open*']);
  });
});

describe('parseAlmor: DEFAULTS', () => {
  it('parses rows keyed by pos, with * as null and the *-row key null', () => {
    const db = parseAlmor(makeDoc());
    expect(db.defaults.get('noun')).toEqual({ pos: 'noun', gen: 'm' });
    expect(db.defaults.get(null)).toEqual({ pos: null });
  });

  it('rejects a line that does not start with DEFAULT', () => {
    expect(() =>
      parseAlmor(makeDoc({ DEFAULTS: ['DEFAUL pos:noun'] })),
    ).toThrow(DatabaseParseError);
  });

  it('rejects a row without a pos feature', () => {
    expect(() => parseAlmor(makeDoc({ DEFAULTS: ['DEFAULT gen:m'] }))).toThrow(
      DatabaseParseError,
    );
  });

  it('rejects a feature token without a colon', () => {
    expect(() =>
      parseAlmor(makeDoc({ DEFAULTS: ['DEFAULT pos:noun badtoken'] })),
    ).toThrow(DatabaseParseError);
  });
});

describe('parseAlmor: ORDER', () => {
  it('takes the last line and fills computeFeats at the marker', () => {
    const db = parseAlmor(makeDoc({ ORDER: ['ORDER pos', 'ORDER pos gen'] }));
    expect(db.order).toEqual(['pos', 'gen']);
    expect(db.computeFeats).toEqual(new Set(['pos', 'gen']));
  });

  it('rejects a one-token line', () => {
    expect(() => parseAlmor(makeDoc({ ORDER: ['ORDER'] }))).toThrow(
      DatabaseParseError,
    );
  });

  it('rejects an undefined feature in toks[1]', () => {
    expect(() =>
      parseAlmor(makeDoc({ ORDER: ['ORDER undefinedfeat gen'] })),
    ).toThrow(DatabaseParseError);
  });

  it('checks only toks[1], not later tokens', () => {
    // `undefinedfeat` is at index 2, so it is not checked and the line parses.
    const db = parseAlmor(makeDoc({ ORDER: ['ORDER pos undefinedfeat'] }));
    expect(db.order).toEqual(['pos', 'undefinedfeat']);
  });
});

describe('parseAlmor: TOKENIZATIONS', () => {
  it('adds slice(1) of each line to the tokenization set', () => {
    const db = parseAlmor(
      makeDoc({ TOKENIZATIONS: ['TOKENIZATION pos', 'TOKENIZATION gen'] }),
    );
    expect(db.tokFeats()).toEqual(new Set(['pos', 'gen']));
  });

  it('rejects a one-token line', () => {
    expect(() =>
      parseAlmor(makeDoc({ TOKENIZATIONS: ['TOKENIZATION'] })),
    ).toThrow(DatabaseParseError);
  });

  it('rejects an undefined feature in toks[1]', () => {
    expect(() =>
      parseAlmor(makeDoc({ TOKENIZATIONS: ['TOKENIZATION undefinedfeat'] })),
    ).toThrow(DatabaseParseError);
  });
});

describe('parseAlmor: STEMBACKOFF', () => {
  it('maps the action to its category list', () => {
    const db = parseAlmor(makeDoc());
    expect(db.stemBackoffs.get('ALL')).toEqual(['NOUN', 'VERB']);
  });

  it('rejects a line with fewer than three tokens', () => {
    expect(() =>
      parseAlmor(makeDoc({ STEMBACKOFF: ['STEMBACKOFF ALL'] })),
    ).toThrow(DatabaseParseError);
  });

  it('rejects a line that does not start with STEMBACKOFF', () => {
    expect(() =>
      parseAlmor(makeDoc({ STEMBACKOFF: ['BACKOFF ALL NOUN'] })),
    ).toThrow(DatabaseParseError);
  });
});

describe('parseAlmor: PREFIXES and SUFFIXES', () => {
  it('parses a prefix surface, category and features', () => {
    const db = parseAlmor(makeDoc());
    const entries = db.prefixes.get('wa');
    expect(entries).toEqual([
      { category: 'Pref-0', features: { diac: 'wa', pos: 'noun' } },
    ]);
  });

  it('appends multiple entries under the same surface', () => {
    const db = parseAlmor(
      makeDoc({
        PREFIXES: [
          'wa\tPref-0\tdiac:wa pos:noun',
          'wa\tPref-1\tdiac:wa pos:verb',
        ],
      }),
    );
    expect(db.prefixes.get('wa')).toHaveLength(2);
  });

  it('allows an empty surface (stripped to the empty string)', () => {
    const db = parseAlmor(
      makeDoc({ PREFIXES: ['\tPref-0\tdiac:0 pos:noun'] }),
    );
    expect(db.prefixes.has('')).toBe(true);
  });

  it('keeps a colon inside a feature value', () => {
    const db = parseAlmor(
      makeDoc({ SUFFIXES: ['hu\tSuff-0\tdiac:a:b pos:noun'] }),
    );
    expect(db.suffixes.get('hu')?.[0]?.features['diac']).toBe('a:b');
  });

  it('rejects a prefix line with the wrong number of tab parts', () => {
    expect(() =>
      parseAlmor(makeDoc({ PREFIXES: ['wa Pref-0 diac:wa'] })),
    ).toThrow(DatabaseParseError);
  });

  it('rejects a feature token without a colon', () => {
    expect(() =>
      parseAlmor(makeDoc({ PREFIXES: ['wa\tPref-0\tnopair'] })),
    ).toThrow(DatabaseParseError);
  });
});

describe('parseAlmor: STEMS', () => {
  it('parses a stem and strips its lex to the first segment', () => {
    const db = parseAlmor(makeDoc());
    const entries = db.stems.get('ktb');
    expect(entries).toEqual([
      {
        category: 'Stem-0',
        features: { diac: 'kataba', lex: 'katab', pos: 'verb' },
      },
    ]);
  });

  it('strips lex on a hyphen as well as an underscore', () => {
    const db = parseAlmor(
      makeDoc({ STEMS: ['ktb\tStem-0\tdiac:kataba lex:katab-u pos:verb'] }),
    );
    expect(db.stems.get('ktb')?.[0]?.features['lex']).toBe('katab');
  });

  it('rejects a stem line without a lex feature', () => {
    expect(() =>
      parseAlmor(makeDoc({ STEMS: ['ktb\tStem-0\tdiac:kataba pos:verb'] })),
    ).toThrow(DatabaseParseError);
  });

  it('rejects a stem line with the wrong number of tab parts', () => {
    expect(() =>
      parseAlmor(makeDoc({ STEMS: ['ktb Stem-0 diac:kataba lex:katab'] })),
    ).toThrow(DatabaseParseError);
  });
});

describe('parseAlmor: compatibility tables', () => {
  // A row is a read-only Set: compared by its members in order.
  const members = (set: ReadonlySet<string> | undefined) => (set === undefined ? undefined : [...set]);

  it('builds the three tables as maps of sets', () => {
    const db = parseAlmor(makeDoc());
    expect(db.prefixStemCompat.get('Pref-0')).toBeInstanceOf(Set);
    expect(members(db.prefixStemCompat.get('Pref-0'))).toEqual(['Stem-0']);
    expect(members(db.stemSuffixCompat.get('Stem-0'))).toEqual(['Suff-0']);
    expect(members(db.prefixSuffixCompat.get('Pref-0'))).toEqual(['Suff-0']);
  });

  it('accumulates multiple right categories under one left category', () => {
    const db = parseAlmor(
      makeDoc({ 'TABLE AB': ['Pref-0 Stem-0', 'Pref-0 Stem-1'] }),
    );
    expect(members(db.prefixStemCompat.get('Pref-0'))).toEqual(['Stem-0', 'Stem-1']);
  });

  it('splits a table line on any whitespace run', () => {
    const db = parseAlmor(
      makeDoc({ 'TABLE AB': ['Pref-0   \t  Stem-0'] }),
    );
    expect(members(db.prefixStemCompat.get('Pref-0'))).toEqual(['Stem-0']);
  });

  it('rejects a table line that is not exactly two tokens', () => {
    expect(() =>
      parseAlmor(makeDoc({ 'TABLE AB': ['Pref-0 Stem-0 extra'] })),
    ).toThrow(DatabaseParseError);
  });

  it('rejects a BC line that is not exactly two tokens', () => {
    expect(() =>
      parseAlmor(makeDoc({ 'TABLE BC': ['Stem-0'] })),
    ).toThrow(DatabaseParseError);
  });

  it('rejects an AC line that is not exactly two tokens', () => {
    expect(() =>
      parseAlmor(makeDoc({ 'TABLE AC': ['Pref-0 Suff-0 extra'] })),
    ).toThrow(DatabaseParseError);
  });
});

describe('parseAlmor: affix size bounds', () => {
  it('measures max prefix and suffix size by code point', () => {
    const db = parseAlmor(
      makeDoc({
        PREFIXES: [
          'wa\tPref-0\tdiac:wa pos:noun',
          'bismi\tPref-1\tdiac:bismi pos:noun',
        ],
        SUFFIXES: ['hu\tSuff-0\tdiac:hu pos:noun'],
      }),
    );
    expect(db.maxPrefixSize).toBe(5); // "bismi"
    expect(db.maxSuffixSize).toBe(2); // "hu"
  });

  it('counts an astral surface as one code point per character', () => {
    // A single astral code point (U+1F600) is length 1, not 2.
    const db = parseAlmor(
      makeDoc({ PREFIXES: ['\u{1F600}\tPref-0\tdiac:x pos:noun'] }),
    );
    expect(db.maxPrefixSize).toBe(1);
  });

  it('is zero when a section has no surfaces', () => {
    const db = parseAlmor(makeDoc({ PREFIXES: [], SUFFIXES: [] }));
    expect(db.maxPrefixSize).toBe(0);
    expect(db.maxSuffixSize).toBe(0);
  });
});

describe('parseAlmor: line-terminator handling', () => {
  it('parses the same document under CRLF terminators', () => {
    const crlf = makeDoc().replace(/\n/gu, '\r\n');
    const db = parseAlmor(crlf);
    expect(db.prefixes.get('wa')?.[0]?.category).toBe('Pref-0');
    expect(db.stems.get('ktb')?.[0]?.features['lex']).toBe('katab');
  });
});
