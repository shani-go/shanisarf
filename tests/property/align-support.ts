// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Shared support for the clitic-segments, vowel-marks and agreed-marks
// properties: the word and form arbitraries, an independent reading of the
// Letters and marks the properties compare against, and the Database_Pin's
// Lexical_Analyses (`source` `lex` or `spvar`, backoff `NONE`) over the
// mark-free `db-forms` words, computed once per worker. The Arabic comes from
// the engine's own character sets and the committed `db-forms` Word_List.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';

import { Analyzer, parseAlmor, type Analysis } from '../../src/engine/index.js';
import { AR_DIAC_CHARSET, AR_LETTERS_CHARSET } from '../../src/engine/charsets.js';
import { foldArabicKey } from '../../src/engine/key-fold.js';
import { loadWordlistWords } from './wordlists.js';

export const TATWEEL = 'ـ';

/** Every Arabic diacritic (the nine of `AR_DIAC_CHARSET`). */
export const MARKS: readonly string[] = [...AR_DIAC_CHARSET];

/** The Arabic letters without the tatweel: the Letters a word is built from. */
export const LETTERS: readonly string[] = [...AR_LETTERS_CHARSET].filter((c) => c !== TATWEEL);

/** A Letter, as the alignment helpers define it: not a mark, not the tatweel. */
export function isLetter(ch: string): boolean {
  return ch !== TATWEEL && !AR_DIAC_CHARSET.has(ch);
}

export function isMark(ch: string): boolean {
  return AR_DIAC_CHARSET.has(ch);
}

/** The Letters of `s` under the Fold, one entry per Letter. */
export function foldedLetters(s: string): string[] {
  return Array.from(s)
    .filter(isLetter)
    .map((c) => foldArabicKey(c));
}

/** The marks of `s` in order. */
export function marksOf(s: string): string {
  return Array.from(s).filter(isMark).join('');
}

// The Fold's classes over LETTERS: a Letter may be swapped for any member of
// its class (the four alef variants with bare alef, alef maksura with yaa,
// teh marbuta with heh) and still match.
const FOLD_CLASS = new Map<string, string[]>();
for (const c of LETTERS) {
  const k = foldArabicKey(c);
  const cls = FOLD_CLASS.get(k) ?? [];
  cls.push(c);
  FOLD_CLASS.set(k, cls);
}

/** The Letters that fold as `c` does (itself included). */
export function foldClassOf(c: string): readonly string[] {
  return FOLD_CLASS.get(foldArabicKey(c)) ?? [c];
}

/** A Letter of the pool, weighted towards the Fold's non-trivial classes. */
export const letterArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 2, arbitrary: fc.constantFrom(...LETTERS) },
  { weight: 1, arbitrary: fc.constantFrom(...[...FOLD_CLASS.values()].filter((c) => c.length > 1).flat()) },
);

/** A Letter that does not fold as `c` does, picked by index. */
export function otherLetter(c: string, pick: number): string {
  const k = foldArabicKey(c);
  const others = LETTERS.filter((x) => foldArabicKey(x) !== k);
  return others[pick % others.length] as string;
}

/** A short mark sequence (0-2 marks), shadda-plus-vowel included. */
export const markSeqArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...MARKS), { maxLength: 2 })
  .map((m) => m.join(''));

/** One position of a word: a Letter, the marks after it, and tatweels. */
export interface WordUnit {
  readonly letter: string;
  readonly marks: string;
  readonly tatweel: boolean;
}

const wordUnitArb = (withMarks: boolean): fc.Arbitrary<WordUnit> =>
  fc.record({
    letter: letterArb,
    marks: withMarks ? fc.option(markSeqArb, { freq: 2, nil: '' }) : fc.constant(''),
    tatweel: fc.boolean(),
  });

/**
 * A word: 1-7 Letters, each optionally followed by marks (when `withMarks`)
 * and a tatweel, after an optional leading tatweel and leading marks.
 */
export function wordArb(withMarks: boolean): fc.Arbitrary<string> {
  return fc
    .record({
      leadTatweel: fc.boolean(),
      lead: withMarks ? fc.option(markSeqArb, { freq: 4, nil: '' }) : fc.constant(''),
      units: fc.array(wordUnitArb(withMarks), { minLength: 1, maxLength: 7 }),
    })
    .map(({ leadTatweel, lead, units }) =>
      (leadTatweel ? TATWEEL : '') +
      lead +
      units.map((u) => u.letter + u.marks + (u.tatweel ? TATWEEL : '')).join(''),
    );
}

/** A mark-free word (tatweel allowed) with at least one Letter. */
export const markFreeWordArb: fc.Arbitrary<string> = wordArb(false);

/**
 * A diac's structure for a mark-free word: the leading marks, then per Letter
 * the Letter written in `diac` (a member of the word Letter's fold class) and
 * the marks after it. Tatweels inserted anywhere in the written diac are
 * placed nowhere, so the structure is what `placeMarks` must reproduce.
 */
export interface DiacForm {
  readonly lead: string;
  readonly letters: readonly string[];
  readonly after: readonly string[];
  readonly diac: string;
}

/**
 * Write a structure as a diac string with tatweels at the given cuts: cut 0 is
 * before the lead marks; for Letter k, cut 3k+1 is right after the Letter,
 * 3k+2 after its first mark, 3k+3 after all its marks.
 */
export function writeDiac(
  lead: string,
  letters: readonly string[],
  after: readonly string[],
  tatweelAt: ReadonlySet<number>,
): string {
  const t = (cut: number): string => (tatweelAt.has(cut) ? TATWEEL : '');
  let out = t(0) + lead;
  letters.forEach((l, k) => {
    const m = after[k] ?? '';
    out += l + t(3 * k + 1) + m.slice(0, 1) + t(3 * k + 2) + m.slice(1) + t(3 * k + 3);
  });
  return out;
}

/** A diac built from `word`'s Letters: random marks, fold-class swaps, tatweels. */
export function diacFormArb(word: string): fc.Arbitrary<DiacForm> {
  const letters = Array.from(word).filter(isLetter);
  return fc
    .record({
      lead: fc.option(markSeqArb, { freq: 3, nil: '' }),
      swaps: fc.array(fc.nat(), { minLength: letters.length, maxLength: letters.length }),
      after: fc.array(fc.option(markSeqArb, { freq: 3, nil: '' }), {
        minLength: letters.length,
        maxLength: letters.length,
      }),
      tatweelAt: fc.uniqueArray(fc.nat({ max: 3 * letters.length + 3 }), { maxLength: 3 }),
    })
    .map(({ lead, swaps, after, tatweelAt }) => {
      const written = letters.map((l, k) => {
        const cls = foldClassOf(l);
        return cls[(swaps[k] ?? 0) % cls.length] as string;
      });
      return { lead, letters: written, after, diac: writeDiac(lead, written, after, new Set(tatweelAt)) };
    });
}

/** The expected placement: lead marks first, each Letter's marks after it. */
export function expectedRender(word: string, lead: string, after: readonly string[]): string {
  let out = lead;
  let k = 0;
  for (const ch of word) {
    out += ch;
    if (isLetter(ch)) {
      out += after[k] ?? '';
      k += 1;
    }
  }
  return out;
}

/**
 * Read a placed result back into positions: the marks before its first
 * non-mark code point, and the marks after each Letter. A placed result of a
 * mark-free word carries marks nowhere else.
 */
export function readPositions(result: string): { lead: string; after: string[] } {
  let lead = '';
  const after: string[] = [];
  let started = false;
  for (const ch of result) {
    if (isMark(ch)) {
      if (!started) lead += ch;
      else if (after.length > 0) after[after.length - 1] += ch;
      else throw new Error(`a mark after a leading tatweel in ${JSON.stringify(result)}`);
    } else {
      started = true;
      if (isLetter(ch)) after.push('');
    }
  }
  return { lead, after };
}

// ---------------------------------------------------------------------------
// The Database_Pin's Lexical_Analyses over the mark-free db-forms words.
// ---------------------------------------------------------------------------

export const DB_PATH = fileURLToPath(new URL('../../data/camel-morph-msa/msa-v1.0.db', import.meta.url));
export const HAVE_PIN = existsSync(DB_PATH);

export interface PinCase {
  readonly word: string;
  readonly analysis: Analysis;
  readonly source: 'lex' | 'spvar';
}

let pinCache: PinCase[] | null = null;

/**
 * Every Lexical_Analysis (`source` `lex` or `spvar`) under backoff `NONE` of
 * every `db-forms` word that carries no mark, parsed and analyzed once per
 * worker.
 */
export function pinLexicalAnalyses(): PinCase[] {
  if (pinCache === null) {
    const db = parseAlmor(readFileSync(DB_PATH, 'utf8'), { flags: 'a' });
    const analyzer = new Analyzer(db, { backoff: 'NONE' });
    const out: PinCase[] = [];
    for (const word of loadWordlistWords('db-forms')) {
      if (word === '' || Array.from(word).some(isMark)) continue;
      for (const analysis of analyzer.analyze(word)) {
        const source = analysis['source'];
        if (source === 'lex' || source === 'spvar') {
          out.push({ word, analysis, source });
        }
      }
    }
    pinCache = out;
  }
  return pinCache;
}

/** A share as `n of d (0.xxxx)`. */
export function share(n: number, d: number): string {
  return `${n} of ${d} (${d === 0 ? 'n/a' : (n / d).toFixed(4)})`;
}
