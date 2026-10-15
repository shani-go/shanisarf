// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Word tokens re-join the input. `simpleWordTokenize(s, splitDigits)` splits
// on Python_Whitespace runs and peels single punctuation/symbol code points and
// whole emoji sequences off each word, optionally splitting digit runs too.
// For both values of `splitDigits`, over strings mixing Arabic letters, digits,
// punctuation, symbols, emoji (astral and multi-code-point) and Python
// whitespace: the tokens concatenate back to the input minus its whitespace; no
// token is empty or holds whitespace; a punctuation/symbol token is one code
// point long; and with `splitDigits`, a token holding a digit is all digits or
// an emoji sequence such as the keycap `1️⃣`, whose `1` the symbol peel claims
// before the digit check, in CAMeL Tools' order.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { AR_CHARSET } from './charsets.js';
import { codePoints, PY_WHITESPACE } from './python-compat.js';
import { simpleWordTokenize } from './word-tokenizer.js';

const NUM_RUNS = 200;
const PER_TEST = { timeout: 20_000 } as const;

// Arabic letters and diacritics, the database's own set.
const AR = [...AR_CHARSET];

// Python whitespace, the tokenizer's word boundary (never JavaScript `\s`).
// Line terminators are excluded on purpose: a word containing one is a corner
// outside parity, and `pySplit` would split on the ones
// that are whitespace anyway, so including them tests nothing new here.
const LINE_TERMINATORS = new Set([
  '\u000a',
  '\u000b',
  '\u000c',
  '\u000d',
  '\u0085',
  '\u2028',
  '\u2029',
]);
const WHITESPACE = [...PY_WHITESPACE].filter(
  (cp) => !LINE_TERMINATORS.has(cp),
);

// Decimal digits (`\p{Nd}`) from two scripts, so `splitDigits` is exercised
// beyond ASCII.
const DIGITS = ['0', '1', '7', '9', '\u0660', '\u0669']; // ASCII + Arabic-Indic

// Single punctuation / symbol code points (each one `\p{P}` or `\p{S}`).
const PUNCT_SYMBOL = ['.', ',', '!', '?', ';', ':', '-', '+', '=', '$', '%'];

// Emoji inputs: a single-scalar emoji, an astral emoji, a skin-tone sequence,
// a ZWJ-joined sequence, a regional-indicator flag pair, and a keycap. These
// deliberately include astral (two UTF-16 units) and multi-code-point
// sequences so the symbol peel's emoji handling meets real input.
const EMOJI_SINGLE = '\u2764'; // ❤ (BMP symbol)
const EMOJI_ASTRAL = '\u{1F600}'; // 😀
const EMOJI_MODIFIER = '\u{1F44D}\u{1F3FD}'; // 👍🏽 thumbs-up + medium skin tone
const EMOJI_ZWJ = '\u{1F468}\u200D\u{1F4BB}'; // 👨‍💻 man + ZWJ + laptop
const EMOJI_FLAG = '\u{1F1F5}\u{1F1F8}'; // 🇵🇸 regional indicators P S
const EMOJI_KEYCAP = '1\uFE0F\u20E3'; // 1️⃣ keycap

/**
 * One "piece" of a generated input: an Arabic run, a whitespace run, a digit
 * run, a punctuation/symbol code point, or an emoji. Each is kept small so
 * shrinking yields a short string.
 */
const pieceArb: fc.Arbitrary<string> = fc.oneof(
  // short Arabic run
  fc
    .array(fc.constantFrom(...AR), { minLength: 1, maxLength: 3 })
    .map((cps) => cps.join('')),
  // short whitespace run (never a line terminator)
  fc
    .array(fc.constantFrom(...WHITESPACE), { minLength: 1, maxLength: 2 })
    .map((cps) => cps.join('')),
  // short digit run
  fc
    .array(fc.constantFrom(...DIGITS), { minLength: 1, maxLength: 3 })
    .map((cps) => cps.join('')),
  // one punctuation / symbol code point
  fc.constantFrom(...PUNCT_SYMBOL),
  // one emoji (possibly a multi-code-point sequence)
  fc.constantFrom(
    EMOJI_SINGLE,
    EMOJI_ASTRAL,
    EMOJI_MODIFIER,
    EMOJI_ZWJ,
    EMOJI_FLAG,
    EMOJI_KEYCAP,
  ),
);

/** A short mixed string: 0..8 pieces concatenated. Includes the empty string. */
const inputArb: fc.Arbitrary<string> = fc
  .array(pieceArb, { maxLength: 8 })
  .map((parts) => parts.join(''));

/** True iff `cp` (a single code point) is Python_Whitespace. */
function isPyWhitespace(cp: string): boolean {
  return PY_WHITESPACE.has(cp);
}

/** True iff `cp` (a single code point) is a decimal digit (`\p{Nd}`). */
const ND_RE = new RegExp('^\\p{Nd}$', 'u');
function isDigit(cp: string): boolean {
  return ND_RE.test(cp);
}

/** True iff `cp` (a single code point) is `\p{P}` or `\p{S}`. */
const PS_RE = new RegExp('^[\\p{P}\\p{S}]$', 'u');
function isPunctOrSymbol(cp: string): boolean {
  return PS_RE.test(cp);
}

/**
 * The input with every Python_Whitespace code point removed — what the tokens
 * must concatenate to.
 */
function withoutWhitespace(s: string): string {
  return codePoints(s)
    .filter((cp) => !isPyWhitespace(cp))
    .join('');
}

/** Assert the clauses that hold for every tokenization, at any `splitDigits`. */
function assertCommonClauses(input: string, tokens: string[]): void {
  // Tokens concatenate back to the input with Python_Whitespace removed.
  expect(tokens.join('')).toBe(withoutWhitespace(input));

  for (const token of tokens) {
    const cps = codePoints(token);

    // No token is empty.
    expect(cps.length).toBeGreaterThan(0);

    // No token contains Python_Whitespace.
    for (const cp of cps) {
      expect(isPyWhitespace(cp)).toBe(false);
    }

    // A single punctuation/symbol token is exactly one code point. (A single
    // P/S code point is only ever emitted as a one-code-point token; a longer
    // token is a letter/digit run or an emoji sequence, never a lone P/S.)
    if (cps.length === 1 && isPunctOrSymbol(token)) {
      expect(cps.length).toBe(1);
    }
  }
}

describe('Word tokens re-join the input', () => {
  it('tokens rejoin the whitespace-stripped input, are non-empty, carry no whitespace, and peel single P/S code points — for splitDigits off and on', PER_TEST, () => {
    fc.assert(
      fc.property(inputArb, fc.boolean(), (input, splitDigits) => {
        const tokens = simpleWordTokenize(input, splitDigits);

        assertCommonClauses(input, tokens);

        if (splitDigits) {
          // With splitDigits, a digit never shares a token with a letter: a
          // token holding a digit is either all digits (an isolated digit
          // run) or a multi-code-point emoji sequence (the keycap `1️⃣`, whose
          // leading digit the symbol/emoji peel claims before the digit check
          // — upstream's check order). A single-code-point token with a digit
          // is therefore always a pure digit.
          for (const token of tokens) {
            const cps = codePoints(token);
            const hasDigit = cps.some(isDigit);
            if (hasDigit) {
              expect(cps.every(isDigit) || cps.length > 1).toBe(true);
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
