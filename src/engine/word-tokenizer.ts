// Ported from CAMeL Tools tokenizers/word.py (version 1.6.0).
// Copyright 2018-2026 New York University Abu Dhabi. MIT License.
// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.
// shanisarf's changes are Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
//
// Word-boundary tokenization. `simpleWordTokenize` splits a string on
// whitespace and peels single punctuation/symbol code points and whole emoji
// sequences off each word, optionally splitting runs of digits too. It is
// upstream's `simple_word_tokenize` / `_simple_word_tokenize[_split_digit]`,
// translated literally, with the port's three systematic changes:
//
//   1. Code points, not code units. Upstream iterates `word` by Python
//      code-point index (`len`, `word[a:b]`, `re.match(word, pos=ndx)`). The
//      port walks the code-point array of each word and, to anchor the
//      symbol/digit regexes "at `pos`" the way Python's `pos=` does, matches
//      the sticky (`y`) regex against the *suffix* of the word from the
//      current code point onward. The `y` flag forces the match to start at
//      index 0 of that suffix, which is exactly upstream's anchored
//      `match(..., pos=ndx)` — never a free `search`. This keeps astral code
//      points (emoji) whole.
//
//   2. Unicode from the host, no committed table. Upstream tests membership in
//      `_SYMBOLS_ALL = UNICODE_PUNCT_SYMBOL_CHARSET | EMOJI_ALL_CHARSET`, two
//      sets it materializes from `unicodedata` and the `emoji` package. The
//      port commits no such table (hard invariant). It replaces the test with
//      the emoji approximation: a match is emitted when it is a *single
//      `\p{P}` or `\p{S}` code point* (the P ∪ S membership, evaluated by the
//      host) *or an emoji string* — a match spanning more than one code point,
//      which the UTS #51 pattern only produces for an emoji sequence (a
//      regional-indicator pair, an `\p{Emoji}` with a modifier / variation
//      selector / keycap / tag sequence, or a ZWJ join). See
//      EMOJI_APPROXIMATION_BOUND below for where this can disagree with
//      upstream; the tokenizer parity fixture records the actual drift on the
//      invented inputs.
//
//   3. `\d` becomes `\p{Nd}`. Upstream's `_DIGITS_RE = r'\d+'` runs under the
//      `regex` module, where `\d` is Unicode-aware (every decimal digit, any
//      script). The port spells that `\p{Nd}+` with the `u` flag — never `\d`,
//      which the lint rule bans and which would mean ASCII-only here.
//
// The two non-parity corners upstream and the port share: a word containing a
// line terminator and an emoji sequence outside the UTS #51 pattern are
// outside parity and outside every Word_List.

import { codePoints, pySplit } from './python-compat.js';
import { UNICODE_PUNCT_CLASS, UNICODE_SYMBOL_CLASS } from './charsets.js';

/**
 * Where the emoji approximation can disagree with upstream's `match_str in
 * (UNICODE_PUNCT_SYMBOL ∪ EMOJI_ALL)`:
 *
 *   - A **single-code-point match that is neither `\p{P}` nor `\p{S}` but is a
 *     true emoji** in the `emoji` package's set (for example a code point the
 *     host's Unicode classifies as `Other` yet upstream treats as emoji).
 *     The port rejects it (it is one code point and not P/S); upstream would
 *     emit it. In practice emoji scalar values carry the `So` (symbol)
 *     category, so `\p{S}` already covers the common ones.
 *   - A **single-code-point match that *is* `\p{P}`/`\p{S}` on the host but
 *     absent from upstream's `unicodedata` build** (a Unicode_Drift between
 *     the host's Unicode version and upstream's). The port emits it;
 *     upstream would not.
 *   - A **multi-code-point UTS #51 match upstream's `_SYMBOLS_ALL` does
 *     not contain** (an emoji sequence the `emoji` package does not list). The
 *     port emits it as one emoji token; upstream would instead advance one
 *     code point and tokenize the pieces.
 *
 * All three are confined to emoji / symbol inputs; no Word_List contains them,
 * and the `word-tokenizer.json.gz` parity fixture records every observed
 * difference against upstream. The analyzer's own paths never call this.
 */
export const EMOJI_APPROXIMATION_BOUND =
  'single P/S code point, or an emoji string matched by the UTS #51 pattern';

// A literal translation of upstream's `_SYMBOLS_RE`, the UTS #51 Emoji regex
// (https://www.unicode.org/reports/tr51/#EBNF_and_Regex). Upstream's `regex`
// short names map to ECMAScript's long property names: `\p{RI}` →
// `\p{Regional_Indicator}`, `\p{EMod}` → `\p{Emoji_Modifier}`; `\p{Emoji}` is
// the same. `\uFE0F` is the emoji variation selector, `\u20E3` the combining
// enclosing keycap, `\u200D` the zero-width joiner, and
// `[\u{E0020}-\u{E007E}]+\u{E007F}` the tag sequence. The `y` (sticky) flag
// anchors the match at `lastIndex` (set per code point below), reproducing
// upstream's `re.match(word, pos=ndx)`; `u` enables the property escapes and
// code-point semantics.
//
// The alternation, exactly as upstream orders it:
//   emoji sequence  |  keycap [0-9*#]⃣  |  \p{S}  |  \p{P}
const EMOJI_SEQUENCE =
  '(?:\\p{Regional_Indicator}\\p{Regional_Indicator}' +
  '|\\p{Emoji}' +
  '(?:\\p{Emoji_Modifier}|\\uFE0F\\u20E3?|[\\u{E0020}-\\u{E007E}]+\\u{E007F})?' +
  '(?:\\u200D' +
  '(?:\\p{Regional_Indicator}\\p{Regional_Indicator}' +
  '|\\p{Emoji}' +
  '(?:\\p{Emoji_Modifier}|\\uFE0F\\u20E3?|[\\u{E0020}-\\u{E007E}]+\\u{E007F})?))*)';

const SYMBOLS_PATTERN =
  '(?:' +
  EMOJI_SEQUENCE +
  '|(?:[0-9*#]\\u20E3)' +
  '|[' +
  UNICODE_SYMBOL_CLASS +
  ']' +
  '|[' +
  UNICODE_PUNCT_CLASS +
  '])';

// A single `\p{P}` or `\p{S}` code point, used for the membership test (the P
// ∪ S half of the emoji approximation).
const SINGLE_PUNCT_SYMBOL_RE = new RegExp(
  '^[' + UNICODE_PUNCT_CLASS + UNICODE_SYMBOL_CLASS + ']$',
  'u',
);

/**
 * Decide whether a symbol-regex match should be emitted as its own token,
 * approximating upstream's `match_str in _SYMBOLS_ALL`. A match is accepted
 * when it is a single `\p{P}`/`\p{S}` code point, or when it spans more than
 * one code point (an emoji sequence the UTS #51 pattern only produces for
 * emoji). See {@link EMOJI_APPROXIMATION_BOUND}.
 */
function isSymbolOrEmoji(match: string): boolean {
  const cps = codePoints(match);
  if (cps.length === 1) {
    return SINGLE_PUNCT_SYMBOL_RE.test(match);
  }
  // More than one code point: a UTS #51 emoji sequence. (The regex never
  // returns an empty match: every alternative consumes at least one code
  // point.)
  return cps.length > 1;
}

/**
 * Tokenize `s` by splitting on whitespace and separating punctuation, symbols
 * and emoji, as upstream's `simple_word_tokenize` does.
 *
 * `pySplit(s)` first breaks the input into whitespace-separated words (Python
 * `str.split()`, Python_Whitespace — never JavaScript `\s`). Within each word
 * the function walks by code point: at each index it tries the UTS #51 symbol
 * pattern anchored there; a match that is a single punctuation/symbol code
 * point or an emoji string is emitted as its own token, after first flushing
 * the pending alphanumeric run. With `splitDigits`, a `\p{Nd}+` run at the
 * index is likewise flushed and emitted. The trailing run of each word is
 * emitted if non-empty.
 *
 * The result has no whitespace and no empty token, and the tokens concatenate
 * back to the input with all Python_Whitespace removed.
 *
 * @param s           The string to tokenize.
 * @param splitDigits When true, also split maximal runs of decimal digits
 *                    (`\p{Nd}+`, any script) into their own tokens. Defaults
 *                    to false.
 */
export function simpleWordTokenize(s: string, splitDigits = false): string[] {
  const tokens: string[] = [];

  // A fresh sticky matcher per call (RegExp carries mutable `lastIndex`).
  const symbolsRe = new RegExp(SYMBOLS_PATTERN, 'uy');
  // `\p{Nd}+` is upstream's Unicode-aware `\d+`, never `\d`.
  const digitsRe = splitDigits ? new RegExp('\\p{Nd}+', 'uy') : null;

  for (const word of pySplit(s)) {
    // Walk the word by code point. `cps` is the code-point array; `offsets`
    // maps a code-point index to its UTF-16 offset in `word`, so the sticky
    // regexes (which use UTF-16 `lastIndex`) anchor exactly at the current
    // code point — reproducing Python's `re.match(word, pos=ndx)` over code
    // points.
    const cps = codePoints(word);
    const wordLen = cps.length;
    const offsets: number[] = new Array(wordLen + 1);
    let acc = 0;
    for (let i = 0; i < wordLen; i++) {
      offsets[i] = acc;
      acc += (cps[i] as string).length;
    }
    offsets[wordLen] = acc;

    let currNdx = 0;
    let currStart = 0;

    while (currNdx < wordLen) {
      const pos = offsets[currNdx] as number;

      // Try the symbol/emoji pattern anchored at the current code point.
      symbolsRe.lastIndex = pos;
      const symbolMatch = symbolsRe.exec(word);
      if (symbolMatch !== null && symbolMatch.index === pos) {
        const matchStr = symbolMatch[0];
        if (isSymbolOrEmoji(matchStr)) {
          if (currNdx !== currStart) {
            tokens.push(cps.slice(currStart, currNdx).join(''));
          }
          tokens.push(matchStr);
          // Advance past the match, in code points. The match ends at UTF-16
          // offset symbolsRe.lastIndex; convert back to a code-point index.
          currNdx = currStart = currNdx + codePoints(matchStr).length;
          continue;
        }
      }

      // With splitDigits, try a decimal-digit run anchored at the current
      // code point (upstream's second check, after the symbol check).
      if (digitsRe !== null) {
        digitsRe.lastIndex = pos;
        const digitMatch = digitsRe.exec(word);
        if (digitMatch !== null && digitMatch.index === pos) {
          const matchStr = digitMatch[0];
          if (currNdx !== currStart) {
            tokens.push(cps.slice(currStart, currNdx).join(''));
          }
          tokens.push(matchStr);
          currNdx = currStart = currNdx + codePoints(matchStr).length;
          continue;
        }
      }

      currNdx += 1;
    }

    // Emit the trailing run if non-empty (upstream's `word[curr_start:]`).
    if (currNdx !== currStart) {
      tokens.push(cps.slice(currStart, currNdx).join(''));
    }
  }

  return tokens;
}
