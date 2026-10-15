// Ported from CAMeL Tools utils/normalize.py (version 1.6.0).
// Copyright 2018-2026 New York University Abu Dhabi. MIT License.
// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.
// shanisarf's changes are Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
//
// Normalization for the five encoding schemes. Each function reproduces
// upstream's rule exactly:
//
//   - the alef normalizers fold a fixed class of alef variants to a plain
//     alef; upstream does this with a compiled regex and `re.sub`, so the port
//     keeps the same character class, translated literally with the `g` and
//     `u` flags, rather than an "equivalent" rewrite;
//   - the alef-maksura and teh-marbuta normalizers each replace one code
//     point with one code point globally (upstream's `str.replace`, which
//     replaces every occurrence);
//   - `normalizeUnicode(s, compatibility)` applies upstream's two-entry
//     fix (the rial sign and the basmala ligature expand to the strings
//     upstream spells) and then NFKC, or NFC alone when `compatibility` is
//     false.
//
// Host-Unicode dependency (Unicode_Drift). `normalizeUnicode` is the one
// function here whose output depends on the JavaScript host's Unicode data:
// `String.prototype.normalize` runs the host's NFKC/NFC, which can differ
// between Unicode versions (upstream's `unicodedata` is one version, the
// host's ICU another — a documented source of Unicode_Drift). This matters
// only to callers that normalize text themselves; **`normalizeUnicode` is not
// on the analyzer's path** — `analyze` never calls it — so this dependency
// cannot move a parity result. The alef/maksura/teh folds below are pure code
// point substitutions and carry no such dependency.

/**
 * The alef variants each encoding folds to a plain alef, as upstream's
 * compiled `_ALEF_NORMALIZE_*_RE` patterns, translated character for
 * character into a global, Unicode-aware character class.
 */
const ALEF_NORMALIZE_BW_RE = /[<>{|]/gu;
const ALEF_NORMALIZE_SAFEBW_RE = /[IOLM]/gu;
const ALEF_NORMALIZE_XMLBW_RE = /[IO{|]/gu;
const ALEF_NORMALIZE_HSB_RE = /[\u0102\u00c2\u00c4\u0100]/gu;
const ALEF_NORMALIZE_AR_RE = /[\u0625\u0623\u0671\u0622]/gu;

/**
 * Upstream's two-entry Unicode fix, applied before NFKC. The Arabic
 * ligature code points U+FDFC (rial sign) and U+FDFD (basmala) expand to the
 * exact strings upstream's `CharMapper` carries. Built directly as a lookup
 * (the general `CharMapper` lives in `charmap.ts`); each code point of the
 * input maps through it, every other code point passing through unchanged, so
 * this reproduces `CharMapper({...})(s)` for a map with no `default` and no
 * ranges.
 */
const UNICODE_CHAR_FIX: ReadonlyMap<string, string> = new Map([
  ['\ufdfc', '\u0631\u064a\u0627\u0644'],
  [
    '\ufdfd',
    '\u0628\u0633\u0645 \u0627\u0644\u0644\u0647 ' +
      '\u0627\u0644\u0631\u062d\u0645\u0646 \u0627\u0644\u0631\u062d\u064a\u0645',
  ],
]);

/**
 * Apply the two-entry fix to every code point of `s` (identity for any code
 * point the fix does not name). Iterates by code point, so an astral
 * character — none is in the fix, but the input may contain one — stays
 * whole.
 */
function applyUnicodeCharFix(s: string): string {
  let out = '';
  for (const cp of s) {
    out += UNICODE_CHAR_FIX.get(cp) ?? cp;
  }
  return out;
}

/**
 * Normalize a string into its canonically composed form. With
 * `compatibility` true (the default), apply upstream's two-entry fix and
 * then NFKC (compatibility decomposition then canonical composition); with it
 * false, apply NFC alone.
 *
 * Host-Unicode dependency: the `normalize` call runs the host's Unicode data
 * and is subject to Unicode_Drift. This function is off the analyzer's path
 * (see the file header); `analyze` never calls it.
 */
export function normalizeUnicode(s: string, compatibility = true): string {
  if (compatibility) {
    return applyUnicodeCharFix(s).normalize('NFKC');
  }
  return s.normalize('NFC');
}

// ---------------------------------------------------------------------------
// Alef maksura → yeh
// ---------------------------------------------------------------------------

/** Fold alef maksura `Y` to yeh `y` in a Buckwalter string. */
export function normalizeAlefMaksuraBw(s: string): string {
  return s.replaceAll('Y', 'y');
}

/** Fold alef maksura `Y` to yeh `y` in a Safe Buckwalter string. */
export function normalizeAlefMaksuraSafebw(s: string): string {
  return s.replaceAll('Y', 'y');
}

/** Fold alef maksura `Y` to yeh `y` in an XML Buckwalter string. */
export function normalizeAlefMaksuraXmlbw(s: string): string {
  return s.replaceAll('Y', 'y');
}

/** Fold alef maksura `ý` (U+00FD) to yeh `y` in a Habash-Soudi-Buckwalter string. */
export function normalizeAlefMaksuraHsb(s: string): string {
  return s.replaceAll('\u00fd', 'y');
}

/** Fold alef maksura `ى` (U+0649) to yeh `ي` (U+064A) in an Arabic string. */
export function normalizeAlefMaksuraAr(s: string): string {
  return s.replaceAll('\u0649', '\u064a');
}

// ---------------------------------------------------------------------------
// Teh marbuta → heh
// ---------------------------------------------------------------------------

/** Fold teh marbuta `p` to heh `h` in a Buckwalter string. */
export function normalizeTehMarbutaBw(s: string): string {
  return s.replaceAll('p', 'h');
}

/** Fold teh marbuta `p` to heh `h` in a Safe Buckwalter string. */
export function normalizeTehMarbutaSafebw(s: string): string {
  return s.replaceAll('p', 'h');
}

/** Fold teh marbuta `p` to heh `h` in an XML Buckwalter string. */
export function normalizeTehMarbutaXmlbw(s: string): string {
  return s.replaceAll('p', 'h');
}

/** Fold teh marbuta `ħ` (U+0127) to heh `h` in a Habash-Soudi-Buckwalter string. */
export function normalizeTehMarbutaHsb(s: string): string {
  return s.replaceAll('\u0127', 'h');
}

/** Fold teh marbuta `ة` (U+0629) to heh `ه` (U+0647) in an Arabic string. */
export function normalizeTehMarbutaAr(s: string): string {
  return s.replaceAll('\u0629', '\u0647');
}

// ---------------------------------------------------------------------------
// Alef variants → plain alef
// ---------------------------------------------------------------------------

/** Fold the alef variants `< > { |` to plain alef `A` in a Buckwalter string. */
export function normalizeAlefBw(s: string): string {
  return s.replace(ALEF_NORMALIZE_BW_RE, 'A');
}

/** Fold the alef variants `I O L M` to plain alef `A` in a Safe Buckwalter string. */
export function normalizeAlefSafebw(s: string): string {
  return s.replace(ALEF_NORMALIZE_SAFEBW_RE, 'A');
}

/** Fold the alef variants `I O { |` to plain alef `A` in an XML Buckwalter string. */
export function normalizeAlefXmlbw(s: string): string {
  return s.replace(ALEF_NORMALIZE_XMLBW_RE, 'A');
}

/**
 * Fold the alef variants `Ă Â Ä Ā` (U+0102, U+00C2, U+00C4, U+0100) to plain
 * alef `A` in a Habash-Soudi-Buckwalter string.
 */
export function normalizeAlefHsb(s: string): string {
  return s.replace(ALEF_NORMALIZE_HSB_RE, 'A');
}

/**
 * Fold the alef variants `إ أ ٱ آ` (U+0625, U+0623, U+0671, U+0622) to plain
 * alef `ا` (U+0627) in an Arabic string.
 */
export function normalizeAlefAr(s: string): string {
  return s.replace(ALEF_NORMALIZE_AR_RE, '\u0627');
}
