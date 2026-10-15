// Ported from CAMeL Tools utils/charsets.py (version 1.6.0).
// Copyright 2018-2026 New York University Abu Dhabi. MIT License.
// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.
// shanisarf's changes are Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
//
// Character sets for the five encoding schemes. Each of upstream's frozensets
// is reproduced here code point for code point, exported both as a
// `ReadonlySet<string>` and as a regex-class fragment (the text that goes
// inside a `[...]` character class, metacharacters escaped) so a consumer can
// test membership either way.
//
// Two systematic departures from upstream:
//
//   - The Unicode category sets (`UNICODE_PUNCT_CHARSET`,
//     `UNICODE_SYMBOL_CHARSET` and their unions), which upstream materializes
//     by scanning all 0x110000 code points through `unicodedata`, are NOT
//     materialized. Committing such a table would both bloat the asset and
//     pin a Unicode version into the repository against the hard invariant
//     that no Unicode-derived table is committed. Instead the port exposes
//     the regex fragments `\p{P}`, `\p{S}` and their union and lets the host
//     evaluate them with the `u` flag. The host's Unicode version is a
//     documented source of Unicode_Drift, recorded per fixture, never patched
//     with a committed table.
//   - The emoji charsets (`EMOJI_*`), which upstream builds from the `emoji`
//     package's data, are not ported as data; the word tokenizer approximates
//     emoji membership with the UTS #51 regex.

/**
 * Escape the characters that are special inside a regex `[...]` character
 * class so an arbitrary code point can be dropped into a class fragment
 * verbatim. Inside a class only `\`, `]`, `^` and `-` carry meaning; every
 * other character (including `$`, `*`, `{`, `|`, `}`, `` ` `` and `.`) is a
 * literal there, so escaping the four is sufficient and keeps the fragments
 * readable. The fragments are composed, never emitted as a `\s`/`\d` escape,
 * so the port's lint rule against them is satisfied.
 */
function toClassFragment(chars: Iterable<string>): string {
  let out = '';
  for (const ch of chars) {
    if (ch === '\\' || ch === ']' || ch === '^' || ch === '-') {
      out += '\\' + ch;
    } else {
      out += ch;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Arabic (native Unicode)
// ---------------------------------------------------------------------------

/**
 * The 42 Arabic letters upstream recognizes: U+0621..U+063A, the tatweel
 * U+0640, U+0641..U+064A, the alef wasla U+0671, and the four Perso-Arabic
 * letters پ (U+067E), چ (U+0686), ڤ (U+06A4) and گ (U+06AF).
 */
const AR_LETTERS =
  '\u0621\u0622\u0623\u0624\u0625\u0626\u0627' +
  '\u0628\u0629\u062a\u062b\u062c\u062d\u062e' +
  '\u062f\u0630\u0631\u0632\u0633\u0634\u0635' +
  '\u0636\u0637\u0638\u0639\u063a\u0640\u0641' +
  '\u0642\u0643\u0644\u0645\u0646\u0647\u0648' +
  '\u0649\u064a\u0671\u067e\u0686\u06a4\u06af';

/**
 * The Arabic diacritics: fathatan U+064B through sukun U+0652, plus the
 * superscript alef U+0670.
 */
const AR_DIAC = '\u064b\u064c\u064d\u064e\u064f\u0650\u0651\u0652\u0670';

export const AR_LETTERS_CHARSET: ReadonlySet<string> = new Set(AR_LETTERS);
export const AR_DIAC_CHARSET: ReadonlySet<string> = new Set(AR_DIAC);
export const AR_CHARSET: ReadonlySet<string> = new Set(AR_LETTERS + AR_DIAC);

export const AR_LETTERS_CLASS: string = toClassFragment(AR_LETTERS_CHARSET);
export const AR_DIAC_CLASS: string = toClassFragment(AR_DIAC_CHARSET);
export const AR_CLASS: string = toClassFragment(AR_CHARSET);

// ---------------------------------------------------------------------------
// Buckwalter (BW)
// ---------------------------------------------------------------------------

// Upstream lists `_` twice in the BW letters string; a set deduplicates it.
const BW_LETTERS = "$&'*<>ADEGHJPSTVYZ_bdfghjklmnpqrstvwxyz{|}_";
const BW_DIAC = 'FKN`aiou~';

export const BW_LETTERS_CHARSET: ReadonlySet<string> = new Set(BW_LETTERS);
export const BW_DIAC_CHARSET: ReadonlySet<string> = new Set(BW_DIAC);
export const BW_CHARSET: ReadonlySet<string> = new Set(BW_LETTERS + BW_DIAC);

export const BW_LETTERS_CLASS: string = toClassFragment(BW_LETTERS_CHARSET);
export const BW_DIAC_CLASS: string = toClassFragment(BW_DIAC_CHARSET);
export const BW_CLASS: string = toClassFragment(BW_CHARSET);

// ---------------------------------------------------------------------------
// Safe Buckwalter (SAFEBW)
// ---------------------------------------------------------------------------

const SAFEBW_LETTERS = 'ABCDEGHIJLMOPQSTVWYZ_bcdefghjklmnpqrstvwxyz';
const SAFEBW_DIAC = 'FKNaeiou~';

export const SAFEBW_LETTERS_CHARSET: ReadonlySet<string> = new Set(
  SAFEBW_LETTERS,
);
export const SAFEBW_DIAC_CHARSET: ReadonlySet<string> = new Set(SAFEBW_DIAC);
export const SAFEBW_CHARSET: ReadonlySet<string> = new Set(
  SAFEBW_LETTERS + SAFEBW_DIAC,
);

export const SAFEBW_LETTERS_CLASS: string =
  toClassFragment(SAFEBW_LETTERS_CHARSET);
export const SAFEBW_DIAC_CLASS: string = toClassFragment(SAFEBW_DIAC_CHARSET);
export const SAFEBW_CLASS: string = toClassFragment(SAFEBW_CHARSET);

// ---------------------------------------------------------------------------
// XML Buckwalter (XMLBW)
// ---------------------------------------------------------------------------

const XMLBW_LETTERS = "$'*ABDEGHIJOPSTWYZ_bdfghjklmnpqrstvwxyz{|}";
const XMLBW_DIAC = 'FKN`aiou~';

export const XMLBW_LETTERS_CHARSET: ReadonlySet<string> = new Set(
  XMLBW_LETTERS,
);
export const XMLBW_DIAC_CHARSET: ReadonlySet<string> = new Set(XMLBW_DIAC);
export const XMLBW_CHARSET: ReadonlySet<string> = new Set(
  XMLBW_LETTERS + XMLBW_DIAC,
);

export const XMLBW_LETTERS_CLASS: string =
  toClassFragment(XMLBW_LETTERS_CHARSET);
export const XMLBW_DIAC_CLASS: string = toClassFragment(XMLBW_DIAC_CHARSET);
export const XMLBW_CLASS: string = toClassFragment(XMLBW_CHARSET);

// ---------------------------------------------------------------------------
// Habash-Soudi-Buckwalter (HSB)
// ---------------------------------------------------------------------------

const HSB_LETTERS =
  "'ADHST_bcdfghjklmnpqrstvwxyz" +
  '\u00c2\u00c4\u00e1\u00f0\u00fd\u0100\u0102' +
  '\u010e\u0127\u0161\u0175\u0177\u03b3\u03b8\u03c2';
const HSB_DIAC = '.aiu~\u00c4\u00e1\u00e3\u0129\u0169';

export const HSB_LETTERS_CHARSET: ReadonlySet<string> = new Set(HSB_LETTERS);
export const HSB_DIAC_CHARSET: ReadonlySet<string> = new Set(HSB_DIAC);
export const HSB_CHARSET: ReadonlySet<string> = new Set(
  HSB_LETTERS + HSB_DIAC,
);

export const HSB_LETTERS_CLASS: string = toClassFragment(HSB_LETTERS_CHARSET);
export const HSB_DIAC_CLASS: string = toClassFragment(HSB_DIAC_CHARSET);
export const HSB_CLASS: string = toClassFragment(HSB_CHARSET);

// ---------------------------------------------------------------------------
// Unicode category fragments (not materialized)
// ---------------------------------------------------------------------------

/**
 * The Unicode punctuation class, as a regex fragment for use inside a
 * `[...]` class with the `u` flag. Evaluated by the host; its Unicode version
 * is a documented source of Unicode_Drift.
 */
export const UNICODE_PUNCT_CLASS = '\\p{P}';

/**
 * The Unicode symbol class, as a regex fragment (see {@link UNICODE_PUNCT_CLASS}).
 */
export const UNICODE_SYMBOL_CLASS = '\\p{S}';

/**
 * The union of the Unicode punctuation and symbol classes, as a regex
 * fragment for use inside a `[...]` class with the `u` flag. This is what the
 * analyzer's `IS_PUNC` and `HAS_PUNC` and the word tokenizer test against.
 */
export const UNICODE_PUNCT_SYMBOL_CLASS = '\\p{P}\\p{S}';
