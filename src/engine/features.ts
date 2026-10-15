// Ported from CAMeL Tools morphology/utils.py (version 1.6.0).
// Copyright 2018-2026 New York University Abu Dhabi. MIT License.
// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.
// shanisarf's changes are Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
//
// Feature constants and the diacritic, CAPHI, tokenization and pattern rewrite
// rules, which the merge in `tuple-merge.ts` calls. Each constant set
// reproduces upstream's frozenset member for member; `AR2CAPHI` is upstream's
// 35-entry map code point for code point; and every rewrite regex is
// translated one-for-one from upstream's `_REWRITE_*_RE_*` with the `g` and
// `u` flags and never "rewritten equivalently".
//
// Two systematic translation choices, both to keep parity exact and to respect
// the port's standing conventions:
//
//   - Code-point semantics. Each pattern carries `u` so a match is over code
//     points, as Python's `re` matches a `str`.
//   - Inert replacements. Python's `re.sub` treats the replacement as a
//     template in which `\1` names a group; JavaScript's
//     `String.prototype.replace` treats `$1`/`$&`/`$'` specially in a *string*
//     replacement. Every `.replace` here passes a *function* replacer, which
//     receives the captured groups as arguments and whose return value is used
//     verbatim, so a `$` or a backslash in matched text can never be
//     reinterpreted. The replacement strings (`$2$2`, `$1_$1`, `ii_$1`, …) are
//     therefore built from the function's group arguments, not from magic `$n`
//     tokens.
//   - The `\S` of CAPHI rule 2 (one non-whitespace code point) cannot be
//     written as `\S` under `src/engine/` (the port's lint rule forbids
//     `\s`/`\S`/`\d`/`\D`). It is translated as a negated class built from
//     `PY_WHITESPACE`, which is exactly Python's whitespace set, so the match
//     set is identical to upstream's `\S` over a Unicode string.

import { PY_WHITESPACE } from './python-compat.js';

// ---------------------------------------------------------------------------
// Feature sets (upstream `_JOIN_FEATS` … `_TOK_SCHEMES_2`), verbatim.
// ---------------------------------------------------------------------------

/** Features whose prefix/stem/suffix values are `'+'`-joined (upstream
 * `_JOIN_FEATS`). */
export const JOIN_FEATS: ReadonlySet<string> = new Set(['gloss', 'bw']);

/** Features whose non-empty prefix/stem/suffix values are `'+'`-joined
 * (upstream `_CONCAT_FEATS`). */
export const CONCAT_FEATS: ReadonlySet<string> = new Set([
  'diac',
  'pattern',
  'caphi',
  'catib6',
  'ud',
]);

/** Features concatenated with no separator, the stem defaulting to its `diac`
 * (upstream `_CONCAT_FEATS_NONE`). */
export const CONCAT_FEATS_NONE: ReadonlySet<string> = new Set([
  'd3tok',
  'd3seg',
  'atbseg',
  'd2seg',
  'd1seg',
  'd1tok',
  'd2tok',
  'atbtok',
  'bwtok',
]);

/** Features converted to a number with default `-99` (upstream
 * `_LOGPROB_FEATS`). */
export const LOGPROB_FEATS: ReadonlySet<string> = new Set([
  'pos_logprob',
  'lex_logprob',
  'pos_lex_logprob',
]);

/** Tokenization/segmentation schemes that get the Sun-letter and Fatha-after-
 * Alif rewrites (upstream `_TOK_SCHEMES_1`). */
export const TOK_SCHEMES_1: ReadonlySet<string> = new Set([
  'd1tok',
  'd2tok',
  'atbtok',
  'd1seg',
  'd2seg',
  'd3seg',
  'atbseg',
]);

/** Tokenization/segmentation schemes that get only the Fatha-after-Alif
 * rewrite (upstream `_TOK_SCHEMES_2`). */
export const TOK_SCHEMES_2: ReadonlySet<string> = new Set(['d3tok', 'd3seg']);

// ---------------------------------------------------------------------------
// Arabic script → CAPHI map (upstream `_AR2CAPHI`), 35 entries, in order.
// ---------------------------------------------------------------------------

/**
 * Upstream's simple Arabic-script-to-CAPHI table, 35 entries, each key a
 * single Arabic code point. Reproduced value for value; note the two code
 * points that map to `aa` (U+0627 alef and U+0649 alef maksura) and the three
 * that carry a trailing `.` (U+0635, U+0636, U+0637, U+0638 — four, in fact).
 */
export const AR2CAPHI: ReadonlyMap<string, string> = new Map([
  ['\u0621', '2'],
  ['\u0622', '2_aa'],
  ['\u0623', '2'],
  ['\u0624', '2'],
  ['\u0625', '2'],
  ['\u0626', '2'],
  ['\u0627', 'aa'],
  ['\u0628', 'b'],
  ['\u062a', 't'],
  ['\u062b', 'th'],
  ['\u062c', 'j'],
  ['\u062d', '7'],
  ['\u062e', 'kh'],
  ['\u062f', 'd'],
  ['\u0630', 'dh'],
  ['\u0631', 'r'],
  ['\u0632', 'z'],
  ['\u0633', 's'],
  ['\u0634', 'sh'],
  ['\u0635', 's.'],
  ['\u0636', 'd.'],
  ['\u0637', 't.'],
  ['\u0638', 'dh.'],
  ['\u0639', '3'],
  ['\u063a', 'gh'],
  ['\u0641', 'f'],
  ['\u0642', 'q'],
  ['\u0643', 'k'],
  ['\u0644', 'l'],
  ['\u0645', 'm'],
  ['\u0646', 'n'],
  ['\u0647', 'h'],
  ['\u0648', 'w'],
  ['\u0649', 'aa'],
  ['\u064a', 'y'],
]);

// ---------------------------------------------------------------------------
// Rewrite regexes (upstream `_STRIP_LEX_RE`, `_REWRITE_DIAC_RE_*`,
// `_REWRITE_CAPHI_RE_*`, `_NORMALIZE_TANWYN_*_RE`), each with `g` and `u`.
// ---------------------------------------------------------------------------

/** `_STRIP_LEX_RE` — splits a lemma on `_` or `-`. */
const STRIP_LEX_RE = /_|-/u;

// Diacritic rewrites.
/** `_REWRITE_DIAC_RE_1` — Sun letters with the definite article. */
const REWRITE_DIAC_RE_1 =
  /#\+*([\u062a\u062b\u062f\u0630\u0631\u0632\u0633\u0634\u0635\u0636\u0637\u0638\u0644\u0646])/gu;
/** `_REWRITE_DIAC_RE_2` — Moon letters with the definite article. */
const REWRITE_DIAC_RE_2 = /#\+*/gu;
/** `_REWRITE_DIAC_RE_3` — Fatha after Alif. */
const REWRITE_DIAC_RE_3 = /\u0627\+?\u064e([\u0629\u062a])/gu;
/** `_REWRITE_DIAC_RE_4` — Hamza Wasl. */
const REWRITE_DIAC_RE_4 = /\u0671/gu;
/** `_REWRITE_DIAC_RE_5` — remove `+`s. */
const REWRITE_DIAC_RE_5 = /\+/gu;
/** `_REWRITE_DIAC_RE_6` — collapse multiple shadda (upstream FIXME: remove
 * after a DB fix). */
const REWRITE_DIAC_RE_6 = /\u0651+/gu;

// CAPHI rewrites. Built once; `\S` of rule 2 is a negated Python-whitespace
// class (see the file header). `NON_WS` lists the whitespace code points to
// negate, from `PY_WHITESPACE`, each as a `\uXXXX` escape so the source stays
// free of raw control characters.
const NON_WS = `[^${[...PY_WHITESPACE]
  .map((cp) => '\\u' + cp.codePointAt(0)!.toString(16).padStart(4, '0'))
  .join('')}]`;

/** `_REWRITE_CAPHI_RE_1` — Sun letters. */
const REWRITE_CAPHI_RE_1 =
  /(l-)\+(t_|th_|d_|th\._|r_|z_|s_|sh_|s\._|d\._|t\._|dh\._|l_|n_|dh_)/gu;
/** `_REWRITE_CAPHI_RE_2` — replace shadda. */
const REWRITE_CAPHI_RE_2 = new RegExp(`(${NON_WS})[-]*\\+~`, 'gu');
/** `_REWRITE_CAPHI_RE_3` — ending `i_y` → `ii` if the suffix is not a vowel. */
const REWRITE_CAPHI_RE_3 = /i_y-\+([^iau]+|$)/gu;
/** `_REWRITE_CAPHI_RE_4` — ending `u_w` → `uu` if the suffix is not a vowel. */
const REWRITE_CAPHI_RE_4 = /u_w-\+([^iau]+|$)/gu;
/** `_REWRITE_CAPHI_RE_5` — remove hamza wasl preceded by a vowel. */
const REWRITE_CAPHI_RE_5 = /([iua])\+-2_[iua]/gu;
/** `_REWRITE_CAPHI_RE_6` — remove hamza wasl preceded by a non-vowel. */
const REWRITE_CAPHI_RE_6 = /(.+)\+-2_([iua])/gu;
/** `_REWRITE_CAPHI_RE_7` — `u+w` followed by non-vowels. */
const REWRITE_CAPHI_RE_7 = /u\+w(_+[^ioua])/gu;
/** `_REWRITE_CAPHI_RE_8` — stems ending with taa marbuta. */
const REWRITE_CAPHI_RE_8 = /p-\+([iua])/gu;
/** `_REWRITE_CAPHI_RE_9` — compress alef madda + fatha + short vowels. */
const REWRITE_CAPHI_RE_9 = /aa\+a[_]*/gu;
/** `_REWRITE_CAPHI_RE_10` — remove `+` and `-`. */
const REWRITE_CAPHI_RE_10 = /[+-]/gu;
/** `_REWRITE_CAPHI_RE_11` — collapse multiple `_`. */
const REWRITE_CAPHI_RE_11 = /_+/gu;
/** `_REWRITE_CAPHI_RE_12` — remove leading/trailing underscores around a
 * trailing taa marbuta. */
const REWRITE_CAPHI_RE_12 = /((^_+)|(_p?_*$))/gu;

// Tanwyn normalization.
/** `_NORMALIZE_TANWYN_FA_RE` — fathatan + alef. */
const NORMALIZE_TANWYN_FA_RE = /\u064b\u0627/gu;
/** `_NORMALIZE_TANWYN_FY_RE` — fathatan + alef maksura. */
const NORMALIZE_TANWYN_FY_RE = /\u064b\u0649/gu;
/** `_NORMALIZE_TANWYN_AF_RE` — alef + fathatan. */
const NORMALIZE_TANWYN_AF_RE = /\u0627\u064b/gu;
/** `_NORMALIZE_TANWYN_YF_RE` — alef maksura + fathatan. */
const NORMALIZE_TANWYN_YF_RE = /\u0649\u064b/gu;

// ---------------------------------------------------------------------------
// Functions (upstream `strip_lex` … `rewrite_pattern`).
// ---------------------------------------------------------------------------

/**
 * `strip_lex` — the part of a lemma before its first `_` or `-`. `String
 * .prototype.split` with a regex keeps the first segment, matching Python's
 * `re.split('_|-', lex)[0]`.
 */
export function stripLex(lex: string): string {
  return lex.split(STRIP_LEX_RE)[0] as string;
}

/**
 * `simple_ar_to_caphi` — convert an Arabic string to CAPHI. If the first code
 * point is a bare alef (U+0627) it is first changed to hamza-alef (U+0623) so
 * it maps to `2` rather than `aa`; then the `AR2CAPHI` value of each code
 * point that has one is joined with `_`, code points absent from the table
 * dropped. Iterates by code point (`for…of`), as Python iterates a `str`.
 */
export function simpleArToCaphi(s: string): string {
  let str = s;
  // `startswith('\u0627')` then `'\u0623{}'.format(ar_str[1:])`: replace the
  // leading code point, sliced on code points so an astral first char is whole.
  const cps = [...str];
  if (cps.length > 0 && cps[0] === '\u0627') {
    str = '\u0623' + cps.slice(1).join('');
  }
  const parts: string[] = [];
  for (const ch of str) {
    const mapped = AR2CAPHI.get(ch);
    if (mapped !== undefined) {
      parts.push(mapped);
    }
  }
  return parts.join('_');
}

/**
 * `normalize_tanwyn` — upstream's four tanwyn rewrites by mode. `FA` rewrites
 * fathatan+alef → fathatan+alef and fathatan+alef-maksura → itself; the
 * default (`AF`) rewrites alef+fathatan → itself and alef-maksura+fathatan →
 * itself. All four are identities in upstream too and are kept verbatim
 * because the merge (step (g)) calls this and an upstream change would land
 * here. The replacements are built in a function replacer so they stay inert.
 */
export function normalizeTanwyn(word: string, mode: string = 'AF'): string {
  let w = word;
  if (mode === 'FA') {
    w = w.replace(NORMALIZE_TANWYN_FA_RE, () => '\u064b\u0627');
    w = w.replace(NORMALIZE_TANWYN_FY_RE, () => '\u064b\u0649');
  } else {
    w = w.replace(NORMALIZE_TANWYN_AF_RE, () => '\u0627\u064b');
    w = w.replace(NORMALIZE_TANWYN_YF_RE, () => '\u0649\u064b');
  }
  return w;
}

/**
 * `rewrite_diac` — the six diacritic rules, in order:
 *   1. `#\+*` before a Sun letter → that letter + shadda (U+0651);
 *   2. remaining `#\+*` → removed;
 *   3. alef (+`+`?) + fatha before taa-marbuta/taa → alef + that letter;
 *   4. hamza wasl (U+0671) → alef (U+0627);
 *   5. `+` → removed;
 *   6. runs of shadda → a single shadda.
 * Each replacement is produced by a function replacer, so a matched `$` or
 * backslash is inert.
 */
export function rewriteDiac(word: string): string {
  let w = word;
  w = w.replace(REWRITE_DIAC_RE_1, (_m, g1: string) => g1 + '\u0651');
  w = w.replace(REWRITE_DIAC_RE_2, () => '');
  w = w.replace(REWRITE_DIAC_RE_3, (_m, g1: string) => '\u0627' + g1);
  w = w.replace(REWRITE_DIAC_RE_4, () => '\u0627');
  w = w.replace(REWRITE_DIAC_RE_5, () => '');
  w = w.replace(REWRITE_DIAC_RE_6, () => '\u0651');
  return w;
}

/**
 * `rewrite_caphi` — the twelve CAPHI rules, in order, with these replacement
 * strings (rule 1 `\2\2`, rule 2 `\1_\1`, rule 3 `ii_\1`, rule 4 `uu_\1`, rule
 * 5 `\1`, rule 6 `\1_\2`, rule 7 `uu\1`, rule 8 `t_\1`, rule 9 `aa_`, rules 10
 * and 11 `_`, rule 12 ``). Each is a function replacer so the captured groups
 * are spliced in literally.
 *
 * Rules 5 and 6 (hamza wasl) can only match where the literal `+-2_` occurs,
 * so each runs only when it does; rule 6's leading `(.+)` otherwise costs a
 * scan from every start position. The test is repeated before rule 6 because
 * rule 5 may remove the only occurrence.
 */
export function rewriteCaphi(word: string): string {
  let w = word;
  w = w.replace(REWRITE_CAPHI_RE_1, (_m, _g1: string, g2: string) => g2 + g2);
  w = w.replace(REWRITE_CAPHI_RE_2, (_m, g1: string) => g1 + '_' + g1);
  w = w.replace(REWRITE_CAPHI_RE_3, (_m, g1: string) => 'ii_' + g1);
  w = w.replace(REWRITE_CAPHI_RE_4, (_m, g1: string) => 'uu_' + g1);
  if (w.includes('+-2_')) {
    w = w.replace(REWRITE_CAPHI_RE_5, (_m, g1: string) => g1);
  }
  if (w.includes('+-2_')) {
    w = w.replace(REWRITE_CAPHI_RE_6, (_m, g1: string, g2: string) => g1 + '_' + g2);
  }
  w = w.replace(REWRITE_CAPHI_RE_7, (_m, g1: string) => 'uu' + g1);
  w = w.replace(REWRITE_CAPHI_RE_8, (_m, g1: string) => 't_' + g1);
  w = w.replace(REWRITE_CAPHI_RE_9, () => 'aa_');
  w = w.replace(REWRITE_CAPHI_RE_10, () => '_');
  w = w.replace(REWRITE_CAPHI_RE_11, () => '_');
  w = w.replace(REWRITE_CAPHI_RE_12, () => '');
  return w;
}

/**
 * `rewrite_tok_1` — rules 1–3 of `rewriteDiac` only (upstream
 * `rewrite_tok_1`), applied to a `TOK_SCHEMES_1` value.
 */
export function rewriteTok1(word: string): string {
  let w = word;
  w = w.replace(REWRITE_DIAC_RE_1, (_m, g1: string) => g1 + '\u0651');
  w = w.replace(REWRITE_DIAC_RE_2, () => '');
  w = w.replace(REWRITE_DIAC_RE_3, (_m, g1: string) => '\u0627' + g1);
  return w;
}

/**
 * `rewrite_tok_2` — rule 3 of `rewriteDiac` only (upstream `rewrite_tok_2`),
 * applied to a `TOK_SCHEMES_2` value.
 */
export function rewriteTok2(word: string): string {
  return word.replace(REWRITE_DIAC_RE_3, (_m, g1: string) => '\u0627' + g1);
}

/**
 * `rewrite_pattern` — rule 2 of `rewriteDiac` only (upstream
 * `rewrite_pattern`), applied to the computed `pattern`.
 */
export function rewritePattern(word: string): string {
  return word.replace(REWRITE_DIAC_RE_2, () => '');
}

// Upstream's `merge_features` is not here: the engine merges over the tuple
// model with `tuple-merge.ts`, which mirrors upstream `utils.merge_features`.
