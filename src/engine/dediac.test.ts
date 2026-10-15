// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for dediacritization: each dediac function removes every code
// point of its encoding's diacritic set and nothing else, globally. Each
// encoding is driven with its own diacritics from charsets.ts: interleaved in
// a word, the whole set at once, repeats, and text that carries none. Test
// words are invented or built from the character sets.
import { describe, expect, it } from 'vitest';

import {
  AR_DIAC_CHARSET,
  BW_DIAC_CHARSET,
  HSB_DIAC_CHARSET,
  SAFEBW_DIAC_CHARSET,
  XMLBW_DIAC_CHARSET,
} from './charsets.js';
import {
  dediacAr,
  dediacBw,
  dediacHsb,
  dediacSafebw,
  dediacXmlbw,
} from './dediac.js';

/** The code points of a set, as a string, for building fixtures. */
function all(set: ReadonlySet<string>): string {
  return [...set].join('');
}

describe('dediacAr', () => {
  it('removes Arabic diacritics interleaved in a word', () => {
    // كَتَبَ (kataba) → كتب: fatha U+064E after each letter.
    expect(dediacAr('\u0643\u064e\u062a\u064e\u0628\u064e')).toBe(
      '\u0643\u062a\u0628',
    );
  });

  it('removes every Arabic diacritic and only those', () => {
    const diacs = all(AR_DIAC_CHARSET);
    expect(dediacAr('\u0627' + diacs + '\u0628')).toBe('\u0627\u0628');
    expect(dediacAr(diacs)).toBe('');
  });

  it('replaces globally, every occurrence', () => {
    // shadda U+0651 three times, between bare letters.
    expect(
      dediacAr('\u0628\u0651\u0628\u0651\u0628\u0651'),
    ).toBe('\u0628\u0628\u0628');
  });

  it('leaves undiacritized Arabic untouched', () => {
    expect(dediacAr('\u0643\u062a\u0628')).toBe('\u0643\u062a\u0628');
    expect(dediacAr('')).toBe('');
  });

  it('does not touch diacritics of other encodings', () => {
    // '~' is a BW/SAFEBW/XMLBW/HSB diacritic but not an Arabic one.
    expect(dediacAr('\u0643~\u062a')).toBe('\u0643~\u062a');
  });
});

describe('dediacBw', () => {
  it('removes BW diacritics interleaved in a word', () => {
    // ktb with fatha 'a' after each consonant.
    expect(dediacBw('kataba')).toBe('ktb');
  });

  it('removes every BW diacritic and only those', () => {
    const diacs = all(BW_DIAC_CHARSET);
    expect(dediacBw('k' + diacs + 't')).toBe('kt');
    expect(dediacBw(diacs)).toBe('');
  });

  it('replaces globally, every occurrence', () => {
    expect(dediacBw('b~b~b~')).toBe('bbb');
  });

  it('leaves undiacritized BW text untouched', () => {
    expect(dediacBw('ktb')).toBe('ktb');
    expect(dediacBw('')).toBe('');
  });
});

describe('dediacSafebw', () => {
  it('removes SAFEBW diacritics interleaved in a word', () => {
    expect(dediacSafebw('kataba')).toBe('ktb');
  });

  it('removes every SAFEBW diacritic and only those', () => {
    const diacs = all(SAFEBW_DIAC_CHARSET);
    expect(dediacSafebw('k' + diacs + 't')).toBe('kt');
    expect(dediacSafebw(diacs)).toBe('');
  });

  it('replaces globally, every occurrence', () => {
    expect(dediacSafebw('b~b~b~')).toBe('bbb');
  });

  it('leaves undiacritized SAFEBW text untouched', () => {
    expect(dediacSafebw('ktb')).toBe('ktb');
  });

  it('treats the SAFEBW-only diacritic e, absent from BW', () => {
    // 'e' is a SAFEBW diacritic but not a BW one.
    expect(dediacSafebw('keb')).toBe('kb');
    expect(dediacBw('keb')).toBe('keb');
  });
});

describe('dediacXmlbw', () => {
  it('removes XMLBW diacritics interleaved in a word', () => {
    expect(dediacXmlbw('kataba')).toBe('ktb');
  });

  it('removes every XMLBW diacritic and only those', () => {
    const diacs = all(XMLBW_DIAC_CHARSET);
    expect(dediacXmlbw('k' + diacs + 't')).toBe('kt');
    expect(dediacXmlbw(diacs)).toBe('');
  });

  it('replaces globally, every occurrence', () => {
    expect(dediacXmlbw('b~b~b~')).toBe('bbb');
  });

  it('leaves undiacritized XMLBW text untouched', () => {
    expect(dediacXmlbw('ktb')).toBe('ktb');
  });
});

describe('dediacHsb', () => {
  it('removes HSB diacritics interleaved in a word', () => {
    // 'a', 'i', 'u' are HSB diacritics.
    expect(dediacHsb('katib')).toBe('ktb');
  });

  it('removes every HSB diacritic and only those', () => {
    const diacs = all(HSB_DIAC_CHARSET);
    expect(dediacHsb('k' + diacs + 't')).toBe('kt');
    expect(dediacHsb(diacs)).toBe('');
  });

  it('replaces globally, every occurrence', () => {
    expect(dediacHsb('b~b~b~')).toBe('bbb');
  });

  it('removes the HSB non-ASCII diacritics', () => {
    // U+0129 (ĩ) and U+00E3 (ã) are HSB diacritics.
    expect(dediacHsb('k\u0129t\u00e3b')).toBe('ktb');
  });

  it('leaves undiacritized HSB text untouched', () => {
    expect(dediacHsb('ktb')).toBe('ktb');
    expect(dediacHsb('')).toBe('');
  });
});
