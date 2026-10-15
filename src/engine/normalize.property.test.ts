// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The default normalization map. For any Arabic string, its `mapString` is
// idempotent; changes only the seven mapped code points (the four alef variants
// `إ أ آ ٱ`, the alef maksura `ى`, the teh marbuta `ة`, the tatweel `ـ`);
// commutes with `dediacAr`; removes every tatweel; and agrees, on their own
// folds, with normalize.ts's `normalizeAlefAr`, `normalizeAlefMaksuraAr` and
// `normalizeTehMarbutaAr`, so the two definitions of the default folds cannot
// drift apart. Arbitraries include the normalization variants and the
// tatweel, and words stay short so a counterexample shrinks.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { AR_LETTERS_CHARSET } from './charsets.js';
import { CharMapper } from './charmap.js';
import { dediacAr } from './dediac.js';
import {
  normalizeAlefAr,
  normalizeAlefMaksuraAr,
  normalizeTehMarbutaAr,
} from './normalize.js';
import { codePoints } from './python-compat.js';

const NUM_RUNS = 200;
const PER_TEST = { timeout: 20_000 } as const;

// Arabic code points, named so the cases read clearly.
const ALEF = '\u0627'; // ا
const ALEF_HAMZA_BELOW = '\u0625'; // إ
const ALEF_HAMZA_ABOVE = '\u0623'; // أ
const ALEF_WASLA = '\u0671'; // ٱ
const ALEF_MADDA = '\u0622'; // آ
const ALEF_MAKSURA = '\u0649'; // ى
const YEH = '\u064a'; // ي
const TEH_MARBUTA = '\u0629'; // ة
const HEH = '\u0647'; // ه
const TATWEEL = '\u0640'; // ـ

// The equivalent of the analyzer's default normalization map: the four alef variants to a plain alef, the alef maksura to yeh, the
// teh marbuta to heh, and the tatweel to the empty string. Built as a
// CharMapper with no default (absent code points map to themselves).
const DEFAULT_NORMALIZE_MAP = new CharMapper({
  [ALEF_HAMZA_BELOW]: ALEF,
  [ALEF_HAMZA_ABOVE]: ALEF,
  [ALEF_MADDA]: ALEF,
  [ALEF_WASLA]: ALEF,
  [ALEF_MAKSURA]: YEH,
  [TEH_MARBUTA]: HEH,
  [TATWEEL]: '',
});

// The seven code points the map is allowed to change, each with the code
// point it must become.
const MAPPED: ReadonlyMap<string, string> = new Map([
  [ALEF_HAMZA_BELOW, ALEF],
  [ALEF_HAMZA_ABOVE, ALEF],
  [ALEF_MADDA, ALEF],
  [ALEF_WASLA, ALEF],
  [ALEF_MAKSURA, YEH],
  [TEH_MARBUTA, HEH],
  [TATWEEL, ''],
]);

const norm = (s: string): string => DEFAULT_NORMALIZE_MAP.mapString(s);

// A word arbitrary over Arabic: the full letter set (which already contains
// the alef variants, the alef maksura and the teh marbuta) plus a few Arabic
// diacritics, so dediacAr has something to remove, and the tatweel over-
// weighted by its own entry so the "removes every tatweel" clause bites.
const AR_DIAC_SAMPLE = ['\u064e', '\u064f', '\u0650', '\u0651']; // fatha..shadda
const arabicAlphabet = [
  ...AR_LETTERS_CHARSET,
  ...AR_DIAC_SAMPLE,
  TATWEEL,
  TATWEEL, // extra weight: tatweel is common in the real inputs
];
const arabicWordArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...arabicAlphabet), { maxLength: 16 })
  .map((cps) => cps.join(''));

describe('The default normalization map', () => {
  it('is idempotent', PER_TEST, () => {
    fc.assert(
      fc.property(arabicWordArb, (s) => {
        const once = norm(s);
        expect(norm(once)).toBe(once);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('changes only the seven mapped code points, each to its target', PER_TEST, () => {
    fc.assert(
      fc.property(arabicWordArb, (s) => {
        // The result equals the input with each code point replaced by its
        // mapped value (identity when absent) — so no unmapped code point is
        // ever touched, and each mapped one becomes exactly its target.
        const expected = codePoints(s)
          .map((cp) => MAPPED.get(cp) ?? cp)
          .join('');
        expect(norm(s)).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('commutes with dediacAr', PER_TEST, () => {
    // The map touches only letters (alef/yaa/teh) and the tatweel; dediacAr
    // touches only diacritics. The two sets are disjoint, so the order does
    // not matter.
    fc.assert(
      fc.property(arabicWordArb, (s) => {
        expect(norm(dediacAr(s))).toBe(dediacAr(norm(s)));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('removes every tatweel', PER_TEST, () => {
    fc.assert(
      fc.property(arabicWordArb, (s) => {
        expect(norm(s).includes(TATWEEL)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('agrees with normalizeAlefAr, normalizeAlefMaksuraAr and normalizeTehMarbutaAr on their folds', PER_TEST, () => {
    // The map is the composition of the three per-fold functions (plus tatweel
    // removal). Applying the three folds in turn and then dropping tatweels
    // must equal the map, pinning the two definitions together.
    fc.assert(
      fc.property(arabicWordArb, (s) => {
        const folded = normalizeTehMarbutaAr(
          normalizeAlefMaksuraAr(normalizeAlefAr(s)),
        ).replaceAll(TATWEEL, '');
        expect(norm(s)).toBe(folded);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
