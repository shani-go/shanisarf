// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The Fold: `foldArabicKey(s)` is the engine's default normalization map
// applied to `dediacAr(s)`. It removes every code point of `AR_DIAC_CHARSET`
// and the tatweel, maps the four alef variants to bare alef, alef maksura to
// yaa and teh marbuta to haa, and changes nothing else: exactly what the
// default Analyzer does to its input before the lexical lookup. The Lexicon
// uses it for folded keys and the alignment functions use it Letter by Letter.
// It is idempotent, since `dediacAr` is and the map's targets are not in its
// domain.
//
// This is a new-design file: project header only, in the ported-code check's
// exclusions.

import { DEFAULT_NORMALIZE_MAP } from './analyzer.js';
import { dediacAr } from './dediac.js';

/** A code point the Fold changes: a diacritic, the tatweel or a normalized letter. */
const FOLDED_RE = /[ً-ْٰـآأإٱىة]/u;

/**
 * Fold `s` for matching: `DEFAULT_NORMALIZE_MAP.mapString(dediacAr(s))`.
 * A string with none of the folded code points is returned as itself.
 *
 * @throws {TypeError} If `s` is not a string.
 */
export function foldArabicKey(s: string): string {
  if (typeof s !== 'string') {
    throw new TypeError(`foldArabicKey expects a string, got ${s === null ? 'null' : typeof s}`);
  }
  if (!FOLDED_RE.test(s)) {
    return s;
  }
  return DEFAULT_NORMALIZE_MAP.mapString(dediacAr(s));
}
