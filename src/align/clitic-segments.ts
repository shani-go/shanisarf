// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Clitic segments on the word. `cliticSegments(word, analysis, options)` cuts
// the caller's word where an analysis's segmentation Scheme (`d3seg` by
// default) cuts it, and returns the pieces as slices of the word as written:
// marks and tatweel stay with the Letter before them, and the texts
// concatenate to the word exactly. It returns `null` when the Scheme is not a
// string, is malformed, or its Letters do not line up with the word's under
// the Fold.
//
// The function is pure: it reads no model, keeps no state, changes neither
// argument, and chooses nothing.
//
// This is a new-design file: project header only. `src/align/` holds no
// ported file.

import type { Analysis } from '../engine/analyzer.js';
import { AR_DIAC_CHARSET } from '../engine/charsets.js';
import { dediacAr } from '../engine/dediac.js';
import { foldArabicKey } from '../engine/key-fold.js';

/** The role of a Clitic_Segment. */
export type CliticRole = 'proclitic' | 'stem' | 'enclitic';

/** One piece of the word: a slice of it as written, and its role. */
export interface CliticSegment {
  readonly role: CliticRole;
  readonly text: string;
}

/** Options for `cliticSegments`. */
export interface CliticSegmentsOptions {
  /** The segmentation feature to read; `'d3seg'` by default. */
  scheme?: string;
}

const TATWEEL = 'ـ';

/** A Letter is any code point that is neither an Arabic diacritic nor the tatweel. */
function isLetter(ch: string): boolean {
  return ch !== TATWEEL && !AR_DIAC_CHARSET.has(ch);
}

/** The Letters of `s`, each under the Fold, in order. */
function foldedLetters(s: string): string[] {
  const out: string[] = [];
  for (const ch of s) {
    if (isLetter(ch)) {
      out.push(foldArabicKey(ch));
    }
  }
  return out;
}

interface Piece {
  readonly role: CliticRole;
  readonly letters: readonly string[];
}

/** Parse a Scheme value into its pieces, or `null` when it is malformed. */
function parseScheme(value: string): Piece[] | null {
  const pieces: Piece[] = [];
  let stems = 0;
  for (const part of value.split('_')) {
    if (part === '') {
      continue;
    }
    const pro = part.endsWith('+');
    const en = part.startsWith('+');
    if (pro && en) {
      // A lone '+' both starts and ends with '+'.
      return null;
    }
    const role: CliticRole = pro ? 'proclitic' : en ? 'enclitic' : 'stem';
    const text = pro ? part.slice(0, -1) : en ? part.slice(1) : part;
    const letters = foldedLetters(dediacAr(text));
    if (letters.length === 0) {
      return null;
    }
    if (role === 'stem') {
      stems += 1;
    }
    pieces.push({ role, letters });
  }
  return stems === 1 ? pieces : null;
}

/**
 * Cut `word` into Clitic_Segments where `analysis[options.scheme]` cuts it.
 *
 * @returns The segments in the Scheme's order, their texts slices of `word`
 *   that concatenate to it, or `null` when the Scheme value is not a string,
 *   is malformed (a part with `+` at both ends, a piece without a Letter,
 *   other than one stem), or its Letters differ from the word's under the Fold.
 * @throws {TypeError} If `word` is not a string or `analysis` is not an object.
 */
export function cliticSegments(
  word: string,
  analysis: Analysis,
  options?: CliticSegmentsOptions,
): CliticSegment[] | null {
  if (typeof word !== 'string') {
    throw new TypeError(`cliticSegments expects a string word, got ${word === null ? 'null' : typeof word}`);
  }
  if (typeof analysis !== 'object' || analysis === null) {
    throw new TypeError(
      `cliticSegments expects an analysis object, got ${analysis === null ? 'null' : typeof analysis}`,
    );
  }
  const scheme = options?.scheme ?? 'd3seg';
  const value = analysis[scheme];
  if (typeof value !== 'string') {
    return null;
  }
  const pieces = parseScheme(value);
  if (pieces === null) {
    return null;
  }

  // Align the Letters: the word's, folded, against the pieces' in order.
  const wordLetters = foldedLetters(word);
  let total = 0;
  for (const piece of pieces) {
    for (const letter of piece.letters) {
      if (wordLetters[total] !== letter) {
        return null;
      }
      total += 1;
    }
  }
  if (total !== wordLetters.length) {
    return null;
  }

  // Cut the word: each segment consumes its piece's Letters, then every mark
  // and tatweel that follows its last Letter.
  const chars = Array.from(word);
  const segments: CliticSegment[] = [];
  let i = 0;
  for (const piece of pieces) {
    let text = '';
    let need = piece.letters.length;
    for (let ch = chars[i]; ch !== undefined; ch = chars[i]) {
      if (isLetter(ch)) {
        if (need === 0) {
          break;
        }
        need -= 1;
      }
      text += ch;
      i += 1;
    }
    segments.push(Object.freeze({ role: piece.role, text }));
  }
  return segments;
}
