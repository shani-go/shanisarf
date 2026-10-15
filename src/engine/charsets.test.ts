// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the character sets. The expected code points are the exact
// members of CAMeL Tools 1.6.0's frozensets in utils/charsets.py; the test pins
// each set to them and checks that the companion regex-class fragments accept
// exactly the set's members.
import { describe, expect, it } from 'vitest';

import {
  AR_CHARSET,
  AR_CLASS,
  AR_DIAC_CHARSET,
  AR_DIAC_CLASS,
  AR_LETTERS_CHARSET,
  AR_LETTERS_CLASS,
  BW_CHARSET,
  BW_CLASS,
  BW_DIAC_CHARSET,
  BW_LETTERS_CHARSET,
  HSB_CHARSET,
  HSB_CLASS,
  HSB_DIAC_CHARSET,
  HSB_LETTERS_CHARSET,
  SAFEBW_CHARSET,
  SAFEBW_CLASS,
  SAFEBW_DIAC_CHARSET,
  SAFEBW_LETTERS_CHARSET,
  UNICODE_PUNCT_CLASS,
  UNICODE_PUNCT_SYMBOL_CLASS,
  UNICODE_SYMBOL_CLASS,
  XMLBW_CHARSET,
  XMLBW_CLASS,
  XMLBW_DIAC_CHARSET,
  XMLBW_LETTERS_CHARSET,
} from './charsets.js';

/** Build the set of code points from a string of them (code-point split). */
function cps(s: string): Set<string> {
  return new Set(Array.from(s));
}

function expectSameSet(
  actual: ReadonlySet<string>,
  expected: Set<string>,
): void {
  expect([...actual].sort()).toEqual([...expected].sort());
}

/** A `[...]` class matcher over single code points, with the `u` flag. */
function classMatcher(fragment: string): RegExp {
  return new RegExp(`^[${fragment}]$`, 'u');
}

// Expected members, transcribed from CAMeL Tools 1.6.0 utils/charsets.py.
const EXPECTED_AR_LETTERS = cps(
  '\u0621\u0622\u0623\u0624\u0625\u0626\u0627' +
    '\u0628\u0629\u062a\u062b\u062c\u062d\u062e' +
    '\u062f\u0630\u0631\u0632\u0633\u0634\u0635' +
    '\u0636\u0637\u0638\u0639\u063a\u0640\u0641' +
    '\u0642\u0643\u0644\u0645\u0646\u0647\u0648' +
    '\u0649\u064a\u0671\u067e\u0686\u06a4\u06af',
);
const EXPECTED_AR_DIAC = cps(
  '\u064b\u064c\u064d\u064e\u064f\u0650\u0651\u0652\u0670',
);
const EXPECTED_BW_LETTERS = cps("$&'*<>ADEGHJPSTVYZ_bdfghjklmnpqrstvwxyz{|}");
const EXPECTED_BW_DIAC = cps('FKN`aiou~');
const EXPECTED_SAFEBW_LETTERS = cps('ABCDEGHIJLMOPQSTVWYZ_bcdefghjklmnpqrstvwxyz');
const EXPECTED_SAFEBW_DIAC = cps('FKNaeiou~');
const EXPECTED_XMLBW_LETTERS = cps("$'*ABDEGHIJOPSTWYZ_bdfghjklmnpqrstvwxyz{|}");
const EXPECTED_XMLBW_DIAC = cps('FKN`aiou~');
const EXPECTED_HSB_LETTERS = cps(
  "'ADHST_bcdfghjklmnpqrstvwxyz" +
    '\u00c2\u00c4\u00e1\u00f0\u00fd\u0100\u0102' +
    '\u010e\u0127\u0161\u0175\u0177\u03b3\u03b8\u03c2',
);
const EXPECTED_HSB_DIAC = cps('.aiu~\u00c4\u00e1\u00e3\u0129\u0169');

describe('Arabic charsets', () => {
  it('AR_LETTERS_CHARSET is the 42 CAMeL Tools letters including tatweel and پچڤگ', () => {
    expect(AR_LETTERS_CHARSET.size).toBe(42);
    expectSameSet(AR_LETTERS_CHARSET, EXPECTED_AR_LETTERS);
    expect(AR_LETTERS_CHARSET.has('\u0640')).toBe(true); // tatweel
    expect(AR_LETTERS_CHARSET.has('\u0671')).toBe(true); // alef wasla
    expect(AR_LETTERS_CHARSET.has('\u067e')).toBe(true); // پ
    expect(AR_LETTERS_CHARSET.has('\u06af')).toBe(true); // گ
  });

  it('AR_DIAC_CHARSET is fathatan..sukun plus superscript alef (9)', () => {
    expect(AR_DIAC_CHARSET.size).toBe(9);
    expectSameSet(AR_DIAC_CHARSET, EXPECTED_AR_DIAC);
    expect(AR_DIAC_CHARSET.has('\u0670')).toBe(true); // superscript alef
  });

  it('AR_CHARSET is the union of letters and diacritics', () => {
    expect(AR_CHARSET.size).toBe(AR_LETTERS_CHARSET.size + AR_DIAC_CHARSET.size);
    expectSameSet(
      AR_CHARSET,
      new Set([...EXPECTED_AR_LETTERS, ...EXPECTED_AR_DIAC]),
    );
  });
});

describe('Buckwalter / SafeBW / XMLBW / HSB charsets', () => {
  it('BW sets match the CAMeL Tools frozensets', () => {
    expectSameSet(BW_LETTERS_CHARSET, EXPECTED_BW_LETTERS);
    expectSameSet(BW_DIAC_CHARSET, EXPECTED_BW_DIAC);
    expectSameSet(
      BW_CHARSET,
      new Set([...EXPECTED_BW_LETTERS, ...EXPECTED_BW_DIAC]),
    );
  });

  it('SAFEBW sets match the CAMeL Tools frozensets', () => {
    expectSameSet(SAFEBW_LETTERS_CHARSET, EXPECTED_SAFEBW_LETTERS);
    expectSameSet(SAFEBW_DIAC_CHARSET, EXPECTED_SAFEBW_DIAC);
    expectSameSet(
      SAFEBW_CHARSET,
      new Set([...EXPECTED_SAFEBW_LETTERS, ...EXPECTED_SAFEBW_DIAC]),
    );
  });

  it('XMLBW sets match the CAMeL Tools frozensets', () => {
    expectSameSet(XMLBW_LETTERS_CHARSET, EXPECTED_XMLBW_LETTERS);
    expectSameSet(XMLBW_DIAC_CHARSET, EXPECTED_XMLBW_DIAC);
    expectSameSet(
      XMLBW_CHARSET,
      new Set([...EXPECTED_XMLBW_LETTERS, ...EXPECTED_XMLBW_DIAC]),
    );
  });

  it('HSB sets match the CAMeL Tools frozensets', () => {
    expectSameSet(HSB_LETTERS_CHARSET, EXPECTED_HSB_LETTERS);
    expectSameSet(HSB_DIAC_CHARSET, EXPECTED_HSB_DIAC);
    expectSameSet(
      HSB_CHARSET,
      new Set([...EXPECTED_HSB_LETTERS, ...EXPECTED_HSB_DIAC]),
    );
  });
});

describe('regex-class fragments accept exactly their set', () => {
  const cases: Array<[string, ReadonlySet<string>, string]> = [
    ['AR_LETTERS', AR_LETTERS_CHARSET, AR_LETTERS_CLASS],
    ['AR_DIAC', AR_DIAC_CHARSET, AR_DIAC_CLASS],
    ['AR', AR_CHARSET, AR_CLASS],
    ['BW', BW_CHARSET, BW_CLASS],
    ['SAFEBW', SAFEBW_CHARSET, SAFEBW_CLASS],
    ['XMLBW', XMLBW_CHARSET, XMLBW_CLASS],
    ['HSB', HSB_CHARSET, HSB_CLASS],
  ];

  it.each(cases)('%s class matches every member', (_name, set, fragment) => {
    const re = classMatcher(fragment);
    for (const ch of set) {
      expect(re.test(ch)).toBe(true);
    }
  });

  it('class fragments reject code points outside their set', () => {
    // Metacharacters that live in the BW family must stay literal: `-`, `^`,
    // `]` and `\` are not members of any set here, so the fragment must not
    // let an arbitrary non-member through.
    const arRe = classMatcher(AR_CLASS);
    expect(arRe.test('a')).toBe(false);
    expect(arRe.test('1')).toBe(false);
    expect(arRe.test(' ')).toBe(false);

    const bwRe = classMatcher(BW_CLASS);
    // `-`, `^`, `]`, backslash are not BW members; the escaping must not
    // accidentally turn the class into a range or negation.
    expect(bwRe.test('-')).toBe(false);
    expect(bwRe.test('^')).toBe(false);
    expect(bwRe.test(']')).toBe(false);
    expect(bwRe.test('\\')).toBe(false);
    // A BW letter still matches.
    expect(bwRe.test('$')).toBe(true);
    expect(bwRe.test('{')).toBe(true);
  });
});

describe('Unicode category fragments (not materialized)', () => {
  it('are the host-evaluated \\p{P}, \\p{S} and their union', () => {
    expect(UNICODE_PUNCT_CLASS).toBe('\\p{P}');
    expect(UNICODE_SYMBOL_CLASS).toBe('\\p{S}');
    expect(UNICODE_PUNCT_SYMBOL_CLASS).toBe('\\p{P}\\p{S}');
  });

  it('evaluate against the host as punctuation and symbol classes', () => {
    const punc = new RegExp(`^[${UNICODE_PUNCT_CLASS}]$`, 'u');
    const sym = new RegExp(`^[${UNICODE_SYMBOL_CLASS}]$`, 'u');
    const both = new RegExp(`^[${UNICODE_PUNCT_SYMBOL_CLASS}]+$`, 'u');
    expect(punc.test('!')).toBe(true);
    expect(punc.test('a')).toBe(false);
    expect(sym.test('+')).toBe(true);
    expect(sym.test('a')).toBe(false);
    expect(both.test('!+')).toBe(true);
    expect(both.test('a')).toBe(false);
  });
});
