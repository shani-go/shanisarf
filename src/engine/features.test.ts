// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Per-rule unit tests for the rewrite functions of `features.ts`. One test per
// rewrite rule, each with a hand-made input and the output CAMeL Tools 1.6.0
// (`morphology/utils.py`) produces for it, cited in a comment against its
// `_REWRITE_*` regex and replacement. Inputs are synthetic probes of a single
// rule. Arabic code points are written as `\uXXXX` escapes so the file stays
// free of right-to-left reordering in an editor; a comment names each.
import { describe, expect, it } from 'vitest';

import {
  AR2CAPHI,
  normalizeTanwyn,
  rewriteCaphi,
  rewriteDiac,
  rewritePattern,
  rewriteTok1,
  rewriteTok2,
  simpleArToCaphi,
  stripLex,
} from './features.js';

// Arabic code points used below, named once for readability.
const ALEF = '\u0627'; // ا
const ALEF_WASLA = '\u0671'; // ٱ
const ALEF_MAKSURA = '\u0649'; // ى
const TEH = '\u062a'; // ت  (a Sun letter)
const BEH = '\u0628'; // ب  (a Moon letter)
const TEH_MARBUTA = '\u0629'; // ة
const FATHA = '\u064e'; // َ
const FATHATAN = '\u064b'; // ً
const SHADDA = '\u0651'; // ّ

// ---------------------------------------------------------------------------
// stripLex (upstream `strip_lex`: `_STRIP_LEX_RE.split(lex)[0]`).
// ---------------------------------------------------------------------------

describe('stripLex', () => {
  it('returns the part of a lemma before the first _ or -', () => {
    // CAMeL Tools: re.split('_|-', 'katab_1')[0] == 'katab'. A lemma without a
    // separator is returned whole.
    expect(stripLex('katab_1')).toBe('katab');
    expect(stripLex('katab-1')).toBe('katab');
    expect(stripLex('katab')).toBe('katab');
    // The first separator wins; the rest (including further separators) is
    // dropped. CAMeL Tools: re.split('_|-', 'a_b-c')[0] == 'a'.
    expect(stripLex('a_b-c')).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// simpleArToCaphi (upstream `simple_ar_to_caphi`).
// ---------------------------------------------------------------------------

describe('simpleArToCaphi', () => {
  it('rewrites a leading bare alef to hamza-alef then joins AR2CAPHI values with _', () => {
    // CAMeL Tools: a string starting with 'ا' is first turned into
    // 'أ' + rest, so the leading alef maps to '2' (not 'aa'); each remaining
    // code point contributes its AR2CAPHI value joined by '_'.
    //   input  ا ب ت   (alef, beh, teh)
    //   leading alef -> أ -> '2'; beh -> 'b'; teh -> 't'
    //   => '2_b_t'
    expect(simpleArToCaphi(ALEF + BEH + TEH)).toBe('2_b_t');
  });

  it('drops code points absent from AR2CAPHI and keeps a non-alef lead unchanged', () => {
    // CAMeL Tools: FATHA (a diacritic) is not a key of _AR2CAPHI, so it is
    // skipped; beh -> 'b', teh -> 't'. No leading alef, so no 2-substitution.
    expect(simpleArToCaphi(BEH + FATHA + TEH)).toBe('b_t');
  });

  it('maps every AR2CAPHI key to its recorded value', () => {
    // A direct check against the ported table: each single key alone yields
    // its value (no leading-alef rule triggers except for bare alef, tested
    // above, so we skip U+0627).
    for (const [cp, caphi] of AR2CAPHI) {
      if (cp === ALEF) continue;
      expect(simpleArToCaphi(cp)).toBe(caphi);
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeTanwyn (upstream `normalize_tanwyn`, both modes). Every rewrite is
// an identity in CAMeL Tools today, kept verbatim.
// ---------------------------------------------------------------------------

describe('normalizeTanwyn', () => {
  it('FA mode rewrites fathatan+alef and fathatan+alef-maksura to themselves', () => {
    // CAMeL Tools FA branch: _NORMALIZE_TANWYN_FA_RE (ًا) -> 'ًا';
    // _NORMALIZE_TANWYN_FY_RE (ًى) -> 'ًى'. Both identities.
    expect(normalizeTanwyn(FATHATAN + ALEF, 'FA')).toBe(FATHATAN + ALEF);
    expect(normalizeTanwyn(FATHATAN + ALEF_MAKSURA, 'FA')).toBe(
      FATHATAN + ALEF_MAKSURA,
    );
  });

  it('AF mode (the default) rewrites alef+fathatan and alef-maksura+fathatan to themselves', () => {
    // CAMeL Tools AF branch: _NORMALIZE_TANWYN_AF_RE (اً) -> 'اً';
    // _NORMALIZE_TANWYN_YF_RE (ىً) -> 'ىً'. Both identities. Default mode.
    expect(normalizeTanwyn(ALEF + FATHATAN)).toBe(ALEF + FATHATAN);
    expect(normalizeTanwyn(ALEF_MAKSURA + FATHATAN, 'AF')).toBe(
      ALEF_MAKSURA + FATHATAN,
    );
  });
});

// ---------------------------------------------------------------------------
// rewriteDiac — the six diacritic rules (upstream `rewrite_diac`,
// `_REWRITE_DIAC_RE_1` .. `_REWRITE_DIAC_RE_6`). Each test isolates one rule by
// choosing an input the earlier rules leave untouched.
// ---------------------------------------------------------------------------

describe('rewriteDiac', () => {
  it('rule 1: #\\+* before a Sun letter becomes that letter + shadda', () => {
    // CAMeL Tools _REWRITE_DIAC_RE_1: `#\+*([Sun letters])` -> `\1\1` i.e. the
    // captured Sun letter followed by shadda (U+0651). teh (ت) is a Sun
    // letter. '#ت' -> 'تّ'.
    expect(rewriteDiac('#' + TEH)).toBe(TEH + SHADDA);
    // With intervening '+'s the rule still fires (`#\+*`).
    expect(rewriteDiac('#++' + TEH)).toBe(TEH + SHADDA);
  });

  it('rule 2: a remaining #\\+* (Moon letter / no following Sun letter) is removed', () => {
    // CAMeL Tools _REWRITE_DIAC_RE_2: `#\+*` -> ''. beh (ب) is a Moon letter, so
    // rule 1 does not fire and rule 2 deletes the marker. '#ب' -> 'ب'.
    expect(rewriteDiac('#' + BEH)).toBe(BEH);
    // A bare '#' with trailing '+'s at end of string is removed too.
    expect(rewriteDiac(BEH + '#++')).toBe(BEH);
  });

  it('rule 3: alef (+optional +) + fatha before taa-marbuta/taa becomes alef + that letter', () => {
    // CAMeL Tools _REWRITE_DIAC_RE_3: `ا\+?َ([ةت])` -> `ا\1` (alef then the
    // captured taa-marbuta/taa, dropping the fatha and any '+'). Choose a Moon
    // letter context so rules 1 and 2 do not interfere.
    //   ا + َ + ة  -> ا + ة
    expect(rewriteDiac(ALEF + FATHA + TEH_MARBUTA)).toBe(ALEF + TEH_MARBUTA);
    //   ا + + + َ + ت -> ا + ت  (the optional '+' is consumed)
    expect(rewriteDiac(ALEF + '+' + FATHA + TEH)).toBe(ALEF + TEH);
  });

  it('rule 4: hamza wasl (U+0671) becomes alef (U+0627)', () => {
    // CAMeL Tools _REWRITE_DIAC_RE_4: `ٱ` -> `ا`. Use a Moon-letter neighbour so
    // no earlier rule fires.
    expect(rewriteDiac(ALEF_WASLA + BEH)).toBe(ALEF + BEH);
  });

  it('rule 5: a stray + is removed', () => {
    // CAMeL Tools _REWRITE_DIAC_RE_5: `\+` -> ''. A '+' between two Moon letters
    // survives rules 1–4 and is deleted here. 'ب+ب' -> 'بب'.
    expect(rewriteDiac(BEH + '+' + BEH)).toBe(BEH + BEH);
  });

  it('rule 6: a run of shadda collapses to a single shadda', () => {
    // CAMeL Tools _REWRITE_DIAC_RE_6: `ّ+` -> `ّ`. Two shaddas on a Moon letter
    // collapse to one. 'بّّ' -> 'بّ'.
    expect(rewriteDiac(BEH + SHADDA + SHADDA)).toBe(BEH + SHADDA);
  });
});

// ---------------------------------------------------------------------------
// rewriteCaphi — the twelve CAPHI rules (upstream `rewrite_caphi`,
// `_REWRITE_CAPHI_RE_1` .. `_REWRITE_CAPHI_RE_12`). Each test isolates one rule
// with a CAPHI-token input the earlier rules leave untouched.
// ---------------------------------------------------------------------------

describe('rewriteCaphi', () => {
  it('rule 1: Sun-letter assimilation of the article l- + Sun consonant', () => {
    // CAMeL Tools _REWRITE_CAPHI_RE_1: `(l-)\+(t_|...)` -> `\2\2`, so 'l-+t_'
    // becomes 't_t_' at rule 1. The function then runs the later rules on the
    // whole string: rule 11 (`_+` -> `_`) leaves it, rule 12 (`_p?_*$` -> '')
    // strips the trailing '_', giving 't_t'. CAMeL Tools' `rewrite_caphi`
    // returns the same, since it applies all twelve rules in order.
    expect(rewriteCaphi('l-+t_')).toBe('t_t');
  });

  it('rule 2: shadda (~) after a consonant doubles that consonant', () => {
    // CAMeL Tools _REWRITE_CAPHI_RE_2: `(\S)[-]*\+~` -> `\1_\1`. 'b+~' -> 'b_b'.
    expect(rewriteCaphi('b+~')).toBe('b_b');
    // With a hyphen between: 'b-+~' -> 'b_b'.
    expect(rewriteCaphi('b-+~')).toBe('b_b');
  });

  it('rule 3: ending i_y before a non-vowel suffix becomes ii', () => {
    // CAMeL Tools _REWRITE_CAPHI_RE_3: `i_y-\+([^iau]+|$)` -> `ii_\1`.
    // 'i_y-+t' -> 'ii_t'.
    expect(rewriteCaphi('i_y-+t')).toBe('ii_t');
    // At end of string the group matches empty: rule 3 gives 'ii_', then rule
    // 12 (`_p?_*$` -> '') strips the trailing '_', so 'i_y-+' -> 'ii'.
    expect(rewriteCaphi('i_y-+')).toBe('ii');
  });

  it('rule 4: ending u_w before a non-vowel suffix becomes uu', () => {
    // CAMeL Tools _REWRITE_CAPHI_RE_4: `u_w-\+([^iau]+|$)` -> `uu_\1`.
    // 'u_w-+t' -> 'uu_t'.
    expect(rewriteCaphi('u_w-+t')).toBe('uu_t');
  });

  it('rule 5: hamza wasl 2_ after a vowel + +- is removed, keeping the vowel', () => {
    // CAMeL Tools _REWRITE_CAPHI_RE_5: `([iua])\+-2_[iua]` -> `\1`.
    // 'a+-2_i' -> 'a'.
    expect(rewriteCaphi('a+-2_i')).toBe('a');
  });

  it('rule 6: hamza wasl 2_ after a non-vowel + +- joins with _', () => {
    // CAMeL Tools _REWRITE_CAPHI_RE_6: `(.+)\+-2_([iua])` -> `\1_\2`.
    // 'b+-2_i' -> 'b_i'.
    expect(rewriteCaphi('b+-2_i')).toBe('b_i');
  });

  it('rule 7: u+w before a run of non-i/o/u/a becomes uu', () => {
    // CAMeL Tools _REWRITE_CAPHI_RE_7: `u\+w(_+[^ioua])` -> `uu\1`.
    // 'u+w_t' -> 'uu_t'.
    expect(rewriteCaphi('u+w_t')).toBe('uu_t');
  });

  it('rule 8: taa marbuta p- before a short vowel becomes t_', () => {
    // CAMeL Tools _REWRITE_CAPHI_RE_8: `p-\+([iua])` -> `t_\1`.
    // 'p-+a' -> 't_a'.
    expect(rewriteCaphi('p-+a')).toBe('t_a');
  });

  it('rule 9: alef madda aa + fatha + optional short vowels compresses to aa_', () => {
    // CAMeL Tools _REWRITE_CAPHI_RE_9: `aa\+a[_]*` -> `aa_`, so rule 9 turns
    // 'aa+a__' into 'aa_'; rule 12 (`_p?_*$` -> '') then strips the trailing
    // '_', giving 'aa'. CAMeL Tools' `rewrite_caphi` returns the same.
    expect(rewriteCaphi('aa+a__')).toBe('aa');
  });

  it('rules 10–12: + and - become _, runs of _ collapse, edge _ around p drop', () => {
    // Rule 10 (`[+-]` -> `_`), rule 11 (`_+` -> `_`), rule 12
    // (`((^_+)|(_p?_*$))` -> ``) run in sequence. A compound input exercises
    // all three; the earlier rules do not match it.
    //   'x+y' --(10)--> 'x_y'                 (+ -> _)
    //   'x__y' --(10 no-op,11)--> 'x_y'       (collapse runs)
    //   '_x_' --(10 no-op)--> '_x_' --(11)--> '_x_' --(12)--> 'x'
    //        (leading '_' and trailing '_' stripped)
    expect(rewriteCaphi('x+y')).toBe('x_y');
    expect(rewriteCaphi('x__y')).toBe('x_y');
    expect(rewriteCaphi('_x_')).toBe('x');
    // Rule 12's `_p?_*$` arm: a trailing '_p' is stripped. '_x_p' -> 'x'.
    expect(rewriteCaphi('_x_p')).toBe('x');
  });
});

// ---------------------------------------------------------------------------
// rewriteTok1 / rewriteTok2 / rewritePattern — subsets of rewriteDiac applied
// to tokenization-scheme and pattern values (upstream `rewrite_tok_1`,
// `rewrite_tok_2`, `rewrite_pattern`).
// ---------------------------------------------------------------------------

describe('rewriteTok1', () => {
  it('applies diacritic rules 1–3 only (not rules 4–6)', () => {
    // Rule 1 fires on '#' + Sun letter, as in rewriteDiac.
    expect(rewriteTok1('#' + TEH)).toBe(TEH + SHADDA);
    // Rule 2 removes a Moon-letter '#'.
    expect(rewriteTok1('#' + BEH)).toBe(BEH);
    // Rule 3 collapses alef+fatha before taa.
    expect(rewriteTok1(ALEF + FATHA + TEH_MARBUTA)).toBe(ALEF + TEH_MARBUTA);
    // Rule 4 is NOT applied: hamza wasl survives (rewriteDiac would map it to
    // alef). This is the distinguishing behaviour of rewriteTok1.
    expect(rewriteTok1(ALEF_WASLA + BEH)).toBe(ALEF_WASLA + BEH);
    // Rule 5 is NOT applied: a stray '+' survives.
    expect(rewriteTok1(BEH + '+' + BEH)).toBe(BEH + '+' + BEH);
  });
});

describe('rewriteTok2', () => {
  it('applies diacritic rule 3 only (not rules 1 or 2)', () => {
    // Rule 3 fires.
    expect(rewriteTok2(ALEF + FATHA + TEH)).toBe(ALEF + TEH);
    // Rule 1/2 are NOT applied: a '#' before a Sun letter survives unchanged
    // (rewriteDiac would turn '#ت' into 'تّ').
    expect(rewriteTok2('#' + TEH)).toBe('#' + TEH);
  });
});

describe('rewritePattern', () => {
  it('applies diacritic rule 2 only (removes #\\+*)', () => {
    // Rule 2 removes the '#...' marker.
    expect(rewritePattern('#++' + BEH)).toBe(BEH);
    // Rule 1 is NOT applied: '#' before a Sun letter is simply removed, not
    // turned into a doubled consonant (rewriteDiac would give 'تّ').
    expect(rewritePattern('#' + TEH)).toBe(TEH);
  });
});
