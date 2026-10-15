// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the Fold: each alef variant, alef maksura, teh marbuta, each
// diacritic and the tatweel; idempotence; a string the Fold does not change
// comes back as itself. The key-fold property holds the same over the Arabic
// word arbitraries. Words here are invented letter strings.
import { describe, expect, it } from 'vitest';

import { DEFAULT_NORMALIZE_MAP } from './analyzer.js';
import { AR_DIAC_CHARSET } from './charsets.js';
import { dediacAr } from './dediac.js';
import { foldArabicKey } from './key-fold.js';

const ALEF = 'ا';
const YAA = 'ي';
const HAA = 'ه';
const TATWEEL = 'ـ';
const KTB = 'كتب';

describe('foldArabicKey', () => {
  it('maps each alef variant to bare alef', () => {
    for (const variant of ['إ', 'أ', 'آ', 'ٱ']) {
      expect(foldArabicKey(`${variant}${KTB}`)).toBe(`${ALEF}${KTB}`);
    }
  });

  it('maps alef maksura to yaa and teh marbuta to haa', () => {
    expect(foldArabicKey(`${KTB}ى`)).toBe(`${KTB}${YAA}`);
    expect(foldArabicKey(`${KTB}ة`)).toBe(`${KTB}${HAA}`);
  });

  it('removes each diacritic and the tatweel', () => {
    expect(AR_DIAC_CHARSET.size).toBe(9);
    for (const mark of AR_DIAC_CHARSET) {
      expect(foldArabicKey(`ك${mark}ت${mark}ب`)).toBe(KTB);
    }
    expect(foldArabicKey(`ك${TATWEEL}${TATWEEL}تب`)).toBe(KTB);
  });

  it('agrees with the definition on every code point of the Arabic block and beyond', () => {
    for (let cp = 0x0600; cp <= 0x06ff; cp++) {
      const s = `ك${String.fromCodePoint(cp)}ب`;
      expect(foldArabicKey(s)).toBe(DEFAULT_NORMALIZE_MAP.mapString(dediacAr(s)));
    }
    for (const s of ['abc', '', ' ', 'اَلْ', '\u{1f600}ة']) {
      expect(foldArabicKey(s)).toBe(DEFAULT_NORMALIZE_MAP.mapString(dediacAr(s)));
    }
  });

  it('is idempotent on its output', () => {
    const inputs = [`أَ${KTB}ّة`, `آ${TATWEEL}ىٰ`, KTB, ''];
    for (const s of inputs) {
      const once = foldArabicKey(s);
      expect(foldArabicKey(once)).toBe(once);
    }
  });

  it('returns a Latin string, an empty string and an unfolded Arabic string as themselves', () => {
    for (const s of ['lemma_1', '', KTB]) {
      expect(foldArabicKey(s)).toBe(s);
    }
  });

  it('throws TypeError for a non-string', () => {
    expect(() => foldArabicKey(undefined as unknown as string)).toThrow(TypeError);
    expect(() => foldArabicKey(null as unknown as string)).toThrow(TypeError);
    expect(() => foldArabicKey(3 as unknown as string)).toThrow(TypeError);
  });
});
