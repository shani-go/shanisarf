// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for normalization. Each case fixes the exact substitution CAMeL
// Tools 1.6.0 (utils/normalize.py) performs: the alef folds over their
// character classes, the one-code-point maksura and teh-marbuta folds, and
// `normalizeUnicode`'s two-entry fix with NFKC versus NFC alone. Test strings
// are invented code-point sequences.
import { describe, expect, it } from 'vitest';

import {
  normalizeAlefAr,
  normalizeAlefBw,
  normalizeAlefHsb,
  normalizeAlefMaksuraAr,
  normalizeAlefMaksuraBw,
  normalizeAlefMaksuraHsb,
  normalizeAlefMaksuraSafebw,
  normalizeAlefMaksuraXmlbw,
  normalizeAlefSafebw,
  normalizeAlefXmlbw,
  normalizeTehMarbutaAr,
  normalizeTehMarbutaBw,
  normalizeTehMarbutaHsb,
  normalizeTehMarbutaSafebw,
  normalizeTehMarbutaXmlbw,
  normalizeUnicode,
} from './normalize.js';

// Arabic code points used below, named so the cases read clearly.
const ALEF = '\u0627'; // ا
const ALEF_HAMZA_BELOW = '\u0625'; // إ
const ALEF_HAMZA_ABOVE = '\u0623'; // أ
const ALEF_WASLA = '\u0671'; // ٱ
const ALEF_MADDA = '\u0622'; // آ
const ALEF_MAKSURA = '\u0649'; // ى
const YEH = '\u064a'; // ي
const TEH_MARBUTA = '\u0629'; // ة
const HEH = '\u0647'; // ه
const BEH = '\u0628'; // ب

describe('normalizeAlefAr', () => {
  it('folds each of the four alef variants to a plain alef', () => {
    expect(normalizeAlefAr(ALEF_HAMZA_BELOW)).toBe(ALEF);
    expect(normalizeAlefAr(ALEF_HAMZA_ABOVE)).toBe(ALEF);
    expect(normalizeAlefAr(ALEF_WASLA)).toBe(ALEF);
    expect(normalizeAlefAr(ALEF_MADDA)).toBe(ALEF);
  });

  it('folds every occurrence and leaves other code points untouched', () => {
    const input = ALEF_HAMZA_ABOVE + BEH + ALEF_MADDA + ALEF_MAKSURA;
    expect(normalizeAlefAr(input)).toBe(ALEF + BEH + ALEF + ALEF_MAKSURA);
  });

  it('is identity on a string with no alef variant', () => {
    expect(normalizeAlefAr(BEH + ALEF + YEH)).toBe(BEH + ALEF + YEH);
    expect(normalizeAlefAr('')).toBe('');
  });
});

describe('normalizeAlefMaksuraAr', () => {
  it('folds alef maksura to yeh everywhere', () => {
    expect(normalizeAlefMaksuraAr(ALEF_MAKSURA)).toBe(YEH);
    expect(normalizeAlefMaksuraAr(BEH + ALEF_MAKSURA + ALEF_MAKSURA)).toBe(
      BEH + YEH + YEH,
    );
  });

  it('leaves an existing yeh and other code points untouched', () => {
    expect(normalizeAlefMaksuraAr(BEH + YEH)).toBe(BEH + YEH);
  });
});

describe('normalizeTehMarbutaAr', () => {
  it('folds teh marbuta to heh everywhere', () => {
    expect(normalizeTehMarbutaAr(TEH_MARBUTA)).toBe(HEH);
    expect(normalizeTehMarbutaAr(BEH + TEH_MARBUTA)).toBe(BEH + HEH);
  });

  it('is identity when there is no teh marbuta', () => {
    expect(normalizeTehMarbutaAr(BEH + HEH)).toBe(BEH + HEH);
  });
});

describe('Buckwalter normalizers', () => {
  it('normalizeAlefBw folds < > { | to A', () => {
    expect(normalizeAlefBw('<b>x{y|')).toBe('AbAxAyA');
    expect(normalizeAlefBw('by')).toBe('by');
  });

  it('normalizeAlefMaksuraBw folds Y to y', () => {
    expect(normalizeAlefMaksuraBw('bYZY')).toBe('byZy');
  });

  it('normalizeTehMarbutaBw folds p to h', () => {
    expect(normalizeTehMarbutaBw('ktbp')).toBe('ktbh');
  });
});

describe('Safe Buckwalter normalizers', () => {
  it('normalizeAlefSafebw folds I O L M to A', () => {
    expect(normalizeAlefSafebw('IbOxLM')).toBe('AbAxAA');
  });

  it('normalizeAlefMaksuraSafebw folds Y to y', () => {
    expect(normalizeAlefMaksuraSafebw('bYz')).toBe('byz');
  });

  it('normalizeTehMarbutaSafebw folds p to h', () => {
    expect(normalizeTehMarbutaSafebw('ktbp')).toBe('ktbh');
  });
});

describe('XML Buckwalter normalizers', () => {
  it('normalizeAlefXmlbw folds I O { | to A', () => {
    expect(normalizeAlefXmlbw('Ib{x|O')).toBe('AbAxAA');
  });

  it('normalizeAlefMaksuraXmlbw folds Y to y', () => {
    expect(normalizeAlefMaksuraXmlbw('bYz')).toBe('byz');
  });

  it('normalizeTehMarbutaXmlbw folds p to h', () => {
    expect(normalizeTehMarbutaXmlbw('ktbp')).toBe('ktbh');
  });
});

describe('Habash-Soudi-Buckwalter normalizers', () => {
  it('normalizeAlefHsb folds the four accented alefs to A', () => {
    // U+0102, U+00C2, U+00C4, U+0100
    expect(normalizeAlefHsb('\u0102b\u00c2x\u00c4\u0100')).toBe('AbAxAA');
  });

  it('normalizeAlefMaksuraHsb folds U+00FD to y', () => {
    expect(normalizeAlefMaksuraHsb('b\u00fdz')).toBe('byz');
  });

  it('normalizeTehMarbutaHsb folds U+0127 to h', () => {
    expect(normalizeTehMarbutaHsb('ktb\u0127')).toBe('ktbh');
  });
});

describe('normalizeUnicode', () => {
  const RIAL_SIGN = '\ufdfc'; // ﷼
  const BASMALA_LIGATURE = '\ufdfd'; // ﷽
  const RIAL_WORD = '\u0631\u064a\u0627\u0644'; // ريال
  const BASMALA =
    '\u0628\u0633\u0645 \u0627\u0644\u0644\u0647 ' +
    '\u0627\u0644\u0631\u062d\u0645\u0646 \u0627\u0644\u0631\u062d\u064a\u0645';

  it('expands the rial sign through the fix map under compatibility', () => {
    expect(normalizeUnicode(RIAL_SIGN)).toBe(RIAL_WORD);
  });

  it('expands the basmala ligature through the fix map under compatibility', () => {
    expect(normalizeUnicode(BASMALA_LIGATURE)).toBe(BASMALA);
  });

  it('applies compatibility decomposition (NFKC) by default', () => {
    // U+FB01 LATIN SMALL LIGATURE FI decomposes to "fi" under NFKC.
    expect(normalizeUnicode('\ufb01')).toBe('fi');
  });

  it('does NOT expand the fix entries or decompose when compatibility is false', () => {
    // NFC alone leaves the ligature code points and the fi ligature intact.
    expect(normalizeUnicode(RIAL_SIGN, false)).toBe(RIAL_SIGN);
    expect(normalizeUnicode('\ufb01', false)).toBe('\ufb01');
  });

  it('composes canonically under NFC (combining sequence to precomposed)', () => {
    // "e" + U+0301 COMBINING ACUTE ACCENT composes to U+00E9 "é".
    expect(normalizeUnicode('e\u0301', false)).toBe('\u00e9');
    expect(normalizeUnicode('e\u0301')).toBe('\u00e9');
  });

  it('is identity on an already-normalized plain string', () => {
    expect(normalizeUnicode(BEH + ALEF + YEH)).toBe(BEH + ALEF + YEH);
    expect(normalizeUnicode('')).toBe('');
  });
});
