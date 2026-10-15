// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Vowel marks on the word. `placeMarks(word, diac)` places an analysis's
// marks on the caller's own Letters, matched under the Fold, or returns
// `null` when the word already carries a mark or the Letters differ.
// `agreedMarks(word, diacs)` keeps, at each position (the start of the word
// and after each Letter), only the mark sequence every placed form has there.
//
// Both functions are pure: they read only the forms the caller passed, choose
// none and rank nothing.
//
// This is a new-design file: project header only. `src/align/` holds no
// ported file.

import { AR_DIAC_CHARSET } from '../engine/charsets.js';
import { foldArabicKey } from '../engine/key-fold.js';

const TATWEEL = 'ـ';

/** A Letter is any code point that is neither an Arabic diacritic nor the tatweel. */
function isLetter(ch: string): boolean {
  return ch !== TATWEEL && !AR_DIAC_CHARSET.has(ch);
}

/**
 * A placement: the marks at the start (before the first Letter), and the
 * marks after each of the word's Letters, in order.
 */
interface Placement {
  readonly lead: string;
  readonly after: readonly string[];
}

function assertString(name: string, fn: string, value: unknown): asserts value is string {
  if (typeof value !== 'string') {
    throw new TypeError(`${fn} expects a string ${name}, got ${value === null ? 'null' : typeof value}`);
  }
}

/** Whether `word` carries any code point of `AR_DIAC_CHARSET`. */
function hasMark(word: string): boolean {
  for (const ch of word) {
    if (AR_DIAC_CHARSET.has(ch)) {
      return true;
    }
  }
  return false;
}

/** A Letter of a diac, folded, and the marks that follow it. */
interface DiacUnit {
  readonly letter: string;
  marks: string;
}

/**
 * Split `diac` into its leading marks and its Letters, each with the marks
 * that follow it. A tatweel is neither: it is skipped, so marks after it go
 * with the Letter before it (or to the start).
 */
function readDiac(diac: string): { lead: string; units: DiacUnit[] } {
  let lead = '';
  const units: DiacUnit[] = [];
  let last: DiacUnit | undefined;
  for (const ch of diac) {
    if (ch === TATWEEL) {
      continue;
    }
    if (AR_DIAC_CHARSET.has(ch)) {
      if (last === undefined) {
        lead += ch;
      } else {
        last.marks += ch;
      }
    } else {
      last = { letter: foldArabicKey(ch), marks: '' };
      units.push(last);
    }
  }
  return { lead, units };
}

/** Place `diac`'s marks on mark-free `word`'s Letters, or `null`. */
function place(word: string, diac: string): Placement | null {
  if (hasMark(word)) {
    return null;
  }
  const d = readDiac(diac);
  const after: string[] = [];
  for (const ch of word) {
    // A tatweel consumes nothing (the mark test above leaves no mark here).
    if (!isLetter(ch)) {
      continue;
    }
    const unit = d.units[after.length];
    if (unit === undefined || foldArabicKey(ch) !== unit.letter) {
      return null;
    }
    after.push(unit.marks);
  }
  if (after.length !== d.units.length) {
    return null;
  }
  return { lead: d.lead, after };
}

/** Write `word` (mark-free) with a Placement's marks. */
function render(word: string, p: Placement): string {
  let out = p.lead;
  let k = 0;
  for (const ch of word) {
    out += ch;
    if (isLetter(ch)) {
      out += p.after[k] ?? '';
      k += 1;
    }
  }
  return out;
}

/**
 * Place the marks of `diac` on the Letters of `word`, as the word wrote them.
 *
 * @returns The word with each Letter followed by the marks that follow its
 *   matched Letter in `diac`, marks before the diac's first Letter at the
 *   start; or `null` when `word` carries any mark or the Letters differ
 *   under the Fold.
 * @throws {TypeError} If `word` or `diac` is not a string.
 */
export function placeMarks(word: string, diac: string): string | null {
  assertString('word', 'placeMarks', word);
  assertString('diac', 'placeMarks', diac);
  const p = place(word, diac);
  return p === null ? null : render(word, p);
}

/**
 * The marks every form agrees on: place each of `diacs` on `word` and keep,
 * at the start and after each Letter, the mark sequence only when every
 * placed form has the same one there.
 *
 * @returns The word with the agreed marks (equal to `word` when none agreed),
 *   or `null` when `diacs` is empty or any form does not place.
 * @throws {TypeError} If `word` is not a string, `diacs` is not an array, or
 *   any form is not a string.
 */
export function agreedMarks(word: string, diacs: readonly string[]): string | null {
  assertString('word', 'agreedMarks', word);
  if (!Array.isArray(diacs)) {
    throw new TypeError(`agreedMarks expects an array of diacs, got ${diacs === null ? 'null' : typeof diacs}`);
  }
  for (const d of diacs) {
    assertString('diac', 'agreedMarks', d);
  }
  let agreed: { lead: string; after: string[] } | null = null;
  for (const d of diacs) {
    const p = place(word, d);
    if (p === null) {
      return null;
    }
    if (agreed === null) {
      agreed = { lead: p.lead, after: p.after.slice() };
      continue;
    }
    // A position where any two forms disagree keeps no mark; once emptied it
    // stays empty, since it is only ever overwritten with ''.
    if (p.lead !== agreed.lead) {
      agreed.lead = '';
    }
    for (let k = 0; k < agreed.after.length; k += 1) {
      if (p.after[k] !== agreed.after[k]) {
        agreed.after[k] = '';
      }
    }
  }
  if (agreed === null) {
    return null;
  }
  return render(word, agreed);
}
