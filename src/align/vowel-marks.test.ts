// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for `placeMarks` and `agreedMarks`. Words and forms are invented.

import { describe, expect, it } from 'vitest';

import { dediacAr } from '../engine/dediac.js';
import { agreedMarks, placeMarks } from './vowel-marks.js';

const KAF = 'ك';
const TEH = 'ت';
const BEH = 'ب';
const ALEF = 'ا';
const ALEF_HAMZA = 'أ';
const ALEF_WASLA = 'ٱ';
const YEH = 'ي';
const ALEF_MAKSURA = 'ى';
const MEEM = 'م';
const FATHA = 'َ';
const KASRA = 'ِ';
const DAMMA = 'ُ';
const SHADDA = 'ّ';
const SUKUN = 'ْ';
const FATHATAN = 'ً';
const TATWEEL = 'ـ';

const WORD = KAF + TEH + BEH; // an invented three-Letter word
const D_A = KAF + FATHA + TEH + FATHA + BEH + FATHA;
const D_B = KAF + DAMMA + TEH + DAMMA + BEH + SUKUN;
const D_C = KAF + FATHA + TEH + KASRA + BEH + FATHA;

describe('placeMarks', () => {
  it('places each Letter\'s marks after the word\'s own Letter', () => {
    expect(placeMarks(WORD, D_A)).toBe(D_A);
    // The word's alef variants are kept as written; matching is under the Fold.
    expect(placeMarks(ALEF + MEEM + YEH, ALEF_HAMZA + FATHA + MEEM + SUKUN + ALEF_MAKSURA)).toBe(
      ALEF + FATHA + MEEM + SUKUN + YEH,
    );
  });

  it('copies a tatweel inside the word through, with no mark', () => {
    expect(placeMarks(KAF + TATWEEL + TEH + BEH, D_A)).toBe(KAF + FATHA + TATWEEL + TEH + FATHA + BEH + FATHA);
  });

  it('keeps a tatweel at either end of the word', () => {
    expect(placeMarks(TATWEEL + WORD + TATWEEL, D_A)).toBe(TATWEEL + D_A + TATWEEL);
  });

  it('skips a tatweel in the diac and places it nowhere', () => {
    const diac = KAF + FATHA + TATWEEL + TEH + TATWEEL + KASRA + BEH + FATHA + TATWEEL;
    expect(placeMarks(WORD, diac)).toBe(KAF + FATHA + TEH + KASRA + BEH + FATHA);
  });

  it('places leading diac marks at the start and trailing ones after the last Letter', () => {
    const diac = SHADDA + KAF + TEH + BEH + FATHATAN;
    expect(placeMarks(WORD, diac)).toBe(SHADDA + KAF + TEH + BEH + FATHATAN);
    // Leading marks go before the word's first code point, even a tatweel;
    // trailing marks go right after the last Letter, before a trailing tatweel.
    expect(placeMarks(TATWEEL + WORD + TATWEEL, diac)).toBe(SHADDA + TATWEEL + WORD + FATHATAN + TATWEEL);
  });

  it('keeps a shadda-plus-vowel sequence in its order', () => {
    const diac = KAF + FATHA + TEH + SHADDA + FATHA + BEH + FATHA;
    expect(placeMarks(WORD, diac)).toBe(diac);
    const reversed = KAF + FATHA + TEH + FATHA + SHADDA + BEH + FATHA;
    expect(placeMarks(WORD, reversed)).toBe(reversed);
  });

  it('keeps dediacAr(result) equal to the word', () => {
    const word = ALEF_HAMZA + TATWEEL + MEEM;
    const out = placeMarks(word, ALEF_WASLA + KASRA + MEEM + DAMMA);
    expect(out).toBe(ALEF_HAMZA + KASRA + TATWEEL + MEEM + DAMMA);
    expect(dediacAr(out as string)).toBe(word);
  });

  it('returns null for a word that carries any mark', () => {
    expect(placeMarks(KAF + FATHA + TEH + BEH, D_A)).toBeNull();
    expect(placeMarks(WORD + 'ٰ', D_A)).toBeNull();
    // Letters that match, and the diac's own marks: still null.
    expect(placeMarks(KAF + FATHA + TEH + FATHA + BEH + FATHA, D_A)).toBeNull();
    expect(placeMarks(KAF + SUKUN + TEH + BEH, D_A)).toBeNull();
    expect(agreedMarks(KAF + FATHA + TEH + BEH, [D_A, D_C])).toBeNull();
  });

  it('returns null when a Letter differs or is left over on either side', () => {
    expect(placeMarks(WORD, KAF + FATHA + TEH + MEEM)).toBeNull();
    expect(placeMarks(WORD, KAF + FATHA + TEH)).toBeNull();
    expect(placeMarks(KAF + TEH, D_A)).toBeNull();
    expect(placeMarks(WORD, KAF + '_' + TEH + BEH)).toBeNull();
  });

  it('handles empty and mark-only forms', () => {
    expect(placeMarks('', '')).toBe('');
    expect(placeMarks('', FATHA)).toBe(FATHA);
    expect(placeMarks(TATWEEL, '')).toBe(TATWEEL);
    expect(placeMarks(WORD, WORD)).toBe(WORD);
  });

  it('throws TypeError for a non-string argument', () => {
    expect(() => placeMarks(null as unknown as string, D_A)).toThrow(TypeError);
    expect(() => placeMarks(WORD, 3 as unknown as string)).toThrow(TypeError);
  });
});

describe('agreedMarks', () => {
  it('equals placeMarks with one form', () => {
    expect(agreedMarks(WORD, [D_A])).toBe(placeMarks(WORD, D_A));
    expect(agreedMarks(TATWEEL + WORD, [SHADDA + D_B])).toBe(placeMarks(TATWEEL + WORD, SHADDA + D_B));
  });

  it('keeps only the sequences every form has, Letter by Letter', () => {
    expect(agreedMarks(WORD, [D_A, D_C])).toBe(KAF + FATHA + TEH + BEH + FATHA);
  });

  it('compares sequences, not sets', () => {
    const a = KAF + TEH + SHADDA + FATHA + BEH;
    const b = KAF + TEH + FATHA + SHADDA + BEH;
    expect(agreedMarks(WORD, [a, b])).toBe(WORD);
    expect(agreedMarks(WORD, [a, KAF + TEH + SHADDA + BEH])).toBe(WORD);
  });

  it('keeps leading marks only when every form has them', () => {
    expect(agreedMarks(WORD, [SHADDA + D_A, SHADDA + D_C])).toBe(SHADDA + KAF + FATHA + TEH + BEH + FATHA);
    expect(agreedMarks(WORD, [SHADDA + D_A, D_A])).toBe(D_A);
  });

  it('keeps the word\'s tatweel and places no mark on it', () => {
    expect(agreedMarks(KAF + TATWEEL + TEH + BEH, [D_A, D_C])).toBe(KAF + FATHA + TATWEEL + TEH + BEH + FATHA);
  });

  it('does not depend on order or repeats', () => {
    const forms = [D_A, D_C, D_A];
    const expected = agreedMarks(WORD, [D_A, D_C]);
    expect(agreedMarks(WORD, forms)).toBe(expected);
    expect(agreedMarks(WORD, [D_C, D_A])).toBe(expected);
    expect(agreedMarks(WORD, [D_C, D_A, D_C, D_C])).toBe(expected);
    expect(agreedMarks(WORD, [D_A, D_A, D_A])).toBe(D_A);
  });

  it('never adds a mark when a form is added', () => {
    expect(agreedMarks(WORD, [D_A, D_C, D_B])).toBe(WORD);
  });

  it('returns the word, not null, when nothing agreed', () => {
    expect(agreedMarks(WORD, [D_A, D_B])).toBe(WORD);
    expect(agreedMarks(TATWEEL + WORD, [D_A, D_B])).toBe(TATWEEL + WORD);
  });

  it('returns null for an empty list or a form that does not place', () => {
    expect(agreedMarks(WORD, [])).toBeNull();
    expect(agreedMarks(WORD, [D_A, KAF + TEH])).toBeNull();
    expect(agreedMarks(KAF + FATHA + TEH + BEH, [D_A])).toBeNull();
  });

  it('never changes a frozen list of forms', () => {
    const diacs = Object.freeze([D_A, D_C]);
    expect(agreedMarks(WORD, diacs)).toBe(KAF + FATHA + TEH + BEH + FATHA);
    expect(diacs).toEqual([D_A, D_C]);
  });

  it('throws TypeError for a non-string word, a non-array list or a non-string form', () => {
    expect(() => agreedMarks(3 as unknown as string, [D_A])).toThrow(TypeError);
    expect(() => agreedMarks(WORD, D_A as unknown as string[])).toThrow(TypeError);
    expect(() => agreedMarks(WORD, [D_A, null as unknown as string])).toThrow(TypeError);
  });
});
