// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Clitic segments are slices of the word. Over words with marks and tatweel
// and Scheme values built from the word's Letters (random cuts into one stem
// and up to three clitics, random marks, Fold-class swaps), `cliticSegments`
// returns exactly the slices the test computes (a mark or tatweel stays with
// the Letter before it), with one stem, roles following the Scheme, and each
// segment's folded Letters its piece's. A changed, dropped or added Letter,
// two stems, a piece without a Letter, a part with `+` at both ends or a
// non-string value gives `null`; a frozen analysis is unchanged. Over the
// Database_Pin (skipped without `data/`): for every Lexical_Analysis of every
// mark-free `db-forms` word, the result is non-null exactly when the test's
// own reading of the Scheme is well formed and its Letters equal the word's
// under the Fold; the non-null share is printed.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { cliticSegments, type CliticRole } from '../../src/align/clitic-segments.js';
import type { Analysis } from '../../src/engine/analyzer.js';
import {
  HAVE_PIN,
  foldedLetters,
  isLetter,
  letterArb,
  markSeqArb,
  otherLetter,
  foldClassOf,
  pinLexicalAnalyses,
  share,
  wordArb,
} from './align-support.js';

const NUM_RUNS = 200;

interface Piece {
  role: CliticRole;
  letters: string[];
  marks: string[];
  lead: string;
}

interface Built {
  word: string;
  pieces: Piece[];
  /** The code-point index where each segment starts (the first at 0). */
  starts: number[];
  sep: string;
  edges: boolean;
}

function renderPiece(p: Piece): string {
  const text = p.lead + p.letters.map((l, k) => l + (p.marks[k] ?? '')).join('');
  return p.role === 'proclitic' ? `${text}+` : p.role === 'enclitic' ? `+${text}` : text;
}

function renderScheme(pieces: readonly Piece[], sep: string, edges: boolean): string {
  const body = pieces.map(renderPiece).join(sep);
  return edges ? `_${body}_` : body;
}

/** A word and a Scheme built from its Letters. */
const builtArb: fc.Arbitrary<Built> = wordArb(true).chain((word) => {
  const chars = Array.from(word);
  const letterIdx: number[] = [];
  chars.forEach((c, i) => {
    if (isLetter(c)) letterIdx.push(i);
  });
  const n = letterIdx.length;
  const cutsArb: fc.Arbitrary<number[]> =
    n === 1
      ? fc.constant([])
      : fc
          .integer({ min: 0, max: Math.min(3, n - 1) })
          .chain((k) => fc.uniqueArray(fc.integer({ min: 1, max: n - 1 }), { minLength: k, maxLength: k }))
          .map((c) => c.sort((a, b) => a - b));
  return fc
    .record({
      cuts: cutsArb,
      stemPick: fc.nat(),
      swaps: fc.array(fc.nat(), { minLength: n, maxLength: n }),
      marks: fc.array(fc.option(markSeqArb, { freq: 2, nil: '' }), { minLength: n, maxLength: n }),
      leads: fc.array(fc.option(markSeqArb, { freq: 5, nil: '' }), { minLength: 4, maxLength: 4 }),
      sep: fc.constantFrom('_', '_', '__'),
      edges: fc.boolean(),
    })
    .map(({ cuts, stemPick, swaps, marks, leads, sep, edges }) => {
      const bounds = [0, ...cuts, n];
      const stem = stemPick % (cuts.length + 1);
      const pieces: Piece[] = [];
      for (let i = 0; i + 1 < bounds.length; i += 1) {
        const from = bounds[i] as number;
        const to = bounds[i + 1] as number;
        const letters: string[] = [];
        for (let j = from; j < to; j += 1) {
          const cls = foldClassOf(chars[letterIdx[j] as number] as string);
          letters.push(cls[(swaps[j] ?? 0) % cls.length] as string);
        }
        pieces.push({
          role: i < stem ? 'proclitic' : i === stem ? 'stem' : 'enclitic',
          letters,
          marks: marks.slice(from, to),
          lead: leads[i] ?? '',
        });
      }
      const starts = bounds.slice(0, -1).map((b, i) => (i === 0 ? 0 : (letterIdx[b] as number)));
      return { word, pieces, starts, sep, edges };
    });
});

/** The slices the test expects: each segment from its start to the next. */
function expectedTexts(b: Built): string[] {
  const chars = Array.from(b.word);
  return b.starts.map((s, i) => chars.slice(s, b.starts[i + 1] ?? chars.length).join(''));
}

function analysisWith(value: unknown, scheme = 'd3seg'): Analysis {
  const a: Record<string, unknown> = { diac: 'x', source: 'lex' };
  if (value !== undefined) a[scheme] = value;
  return a as Analysis;
}

type Mutation = 'change' | 'drop' | 'add' | 'twoStems' | 'empty' | 'bothPlus' | 'lonePlus';

/** Apply a mutation that must make the Scheme give `null`. */
function mutate(b: Built, kind: Mutation, pick: number, pick2: number, extra: string, marks: string): string {
  const pieces = b.pieces.map((p) => ({ ...p, letters: p.letters.slice(), marks: p.marks.slice() }));
  const flat: [number, number][] = [];
  pieces.forEach((p, i) => p.letters.forEach((_, j) => flat.push([i, j])));
  const [pi, lj] = flat[pick % flat.length] as [number, number];
  const piece = pieces[pi] as Piece;
  switch (kind) {
    case 'change':
      piece.letters[lj] = otherLetter(piece.letters[lj] as string, pick2);
      break;
    case 'drop':
      piece.letters.splice(lj, 1);
      piece.marks.splice(lj, 1);
      break;
    case 'add':
      piece.letters.splice(lj + (pick2 % 2), 0, extra);
      piece.marks.splice(lj + (pick2 % 2), 0, '');
      break;
    case 'twoStems': {
      const clitic = pieces.findIndex((p) => p.role !== 'stem');
      const stem = pieces.find((p) => p.role === 'stem') as Piece;
      if (clitic >= 0) {
        (pieces[clitic] as Piece).role = 'stem';
      } else if (stem.letters.length >= 2) {
        const at = 1 + (pick2 % (stem.letters.length - 1));
        const second: Piece = {
          role: 'stem',
          letters: stem.letters.splice(at),
          marks: stem.marks.splice(at),
          lead: '',
        };
        pieces.splice(pieces.indexOf(stem) + 1, 0, second);
      } else {
        // One Letter only: a second stem cannot avoid adding a Letter.
        pieces.push({ role: 'stem', letters: [extra], marks: [''], lead: '' });
      }
      break;
    }
    case 'empty':
      pieces.splice(pick2 % (pieces.length + 1), 0, {
        role: pick2 % 2 === 0 ? 'proclitic' : 'enclitic',
        letters: [],
        marks: [],
        lead: marks,
      });
      break;
    case 'bothPlus': {
      const text = renderPiece({ ...piece, role: 'stem' });
      const parts = pieces.map(renderPiece);
      parts[pi] = `+${text}+`;
      return parts.join(b.sep);
    }
    case 'lonePlus': {
      const parts = pieces.map(renderPiece);
      parts.splice(pick2 % (parts.length + 1), 0, '+');
      return parts.join(b.sep);
    }
  }
  return renderScheme(pieces, b.sep, b.edges);
}

describe('clitic segments are slices of the word', () => {
  it('cuts the word where a Scheme built from its Letters cuts it', () => {
    fc.assert(
      fc.property(builtArb, fc.boolean(), (b, custom) => {
        const scheme = renderScheme(b.pieces, b.sep, b.edges);
        const analysis = custom
          ? ({ ...analysisWith(scheme, 'atbseg'), d3seg: 'not+_a_scheme' } as Analysis)
          : analysisWith(scheme);
        Object.freeze(analysis);
        const before = JSON.stringify(analysis);
        const segs = custom ? cliticSegments(b.word, analysis, { scheme: 'atbseg' }) : cliticSegments(b.word, analysis);
        expect(JSON.stringify(analysis)).toBe(before);
        expect(segs, `scheme ${JSON.stringify(scheme)}`).not.toBeNull();
        if (segs === null) return;
        expect(segs.map((s) => s.text).join('')).toBe(b.word);
        expect(segs.map((s) => s.text)).toEqual(expectedTexts(b));
        expect(segs.filter((s) => s.role === 'stem')).toHaveLength(1);
        expect(segs.map((s) => s.role)).toEqual(b.pieces.map((p) => p.role));
        segs.forEach((s, i) => {
          expect(foldedLetters(s.text)).toEqual(foldedLetters((b.pieces[i] as Piece).letters.join('')));
        });
      }),
      { numRuns: NUM_RUNS },
    );
  }, 60_000);

  it('gives null for differing Letters, two stems, an empty piece, + at both ends or a non-string', () => {
    const kinds: Mutation[] = ['change', 'drop', 'add', 'twoStems', 'empty', 'bothPlus', 'lonePlus'];
    fc.assert(
      fc.property(
        builtArb,
        fc.constantFrom(...kinds),
        fc.nat(),
        fc.nat(),
        letterArb,
        markSeqArb,
        fc.constantFrom<unknown>(undefined, null, 7, ['a'], { a: 1 }),
        (b, kind, pick, pick2, extra, marks, nonString) => {
          const scheme = mutate(b, kind, pick, pick2, extra, marks);
          const analysis = Object.freeze(analysisWith(scheme));
          expect(cliticSegments(b.word, analysis), `${kind}: ${JSON.stringify(scheme)}`).toBeNull();
          expect(cliticSegments(b.word, Object.freeze(analysisWith(nonString)))).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  }, 60_000);
});

/**
 * The test's own reading of a Scheme against a word (is it well formed, and
 * do its Letters match the word's): 'aligned', or why it is not.
 */
function classify(word: string, scheme: unknown): 'aligned' | 'notString' | 'malformed' | 'lettersDiffer' {
  if (typeof scheme !== 'string') return 'notString';
  const letters: string[] = [];
  let stems = 0;
  for (const part of scheme.split('_')) {
    if (part === '') continue;
    const pro = part.endsWith('+');
    const en = part.startsWith('+');
    if (pro && en) return 'malformed';
    const own = foldedLetters(part.replace(/^\+|\+$/g, ''));
    if (own.length === 0) return 'malformed';
    if (!pro && !en) stems += 1;
    letters.push(...own);
  }
  if (stems !== 1) return 'malformed';
  return letters.join('\u0000') === foldedLetters(word).join('\u0000') ? 'aligned' : 'lettersDiffer';
}

const describePin = HAVE_PIN ? describe : describe.skip;
if (!HAVE_PIN) {
  console.warn('clitic-segments pin case skipped: the Database_Pin is not under data/ (npm run parity:setup).');
}

describePin('clitic segments over the pin', () => {
  it('is non-null exactly when the Scheme is well formed and its Letters are the word\'s', () => {
    const cases = pinLexicalAnalyses();
    const tally = {
      lex: { clitic: 0, nonNull: 0, malformed: 0, lettersDiffer: 0 },
      spvar: { clitic: 0, nonNull: 0, malformed: 0, lettersDiffer: 0 },
    };
    let checked = 0;
    for (const { word, analysis, source } of cases) {
      const scheme = analysis['d3seg'];
      const kind = classify(word, scheme);
      const segs = cliticSegments(word, analysis);
      expect(segs !== null, `${word} ${String(scheme)} (${kind})`).toBe(kind === 'aligned');
      if (segs !== null) {
        expect(segs.map((s) => s.text).join('')).toBe(word);
      }
      checked += 1;
      if (typeof scheme === 'string' && scheme.includes('+')) {
        const t = tally[source];
        t.clitic += 1;
        if (segs !== null) t.nonNull += 1;
        else if (kind === 'malformed') t.malformed += 1;
        else t.lettersDiffer += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(tally.lex.clitic + tally.spvar.clitic).toBeGreaterThan(0);
    const both = tally.lex.nonNull + tally.spvar.nonNull;
    const bothClitic = tally.lex.clitic + tally.spvar.clitic;
    console.log(
      `clitic-segments pin: ${checked} Lexical_Analyses; non-null among those whose Scheme marks a clitic: ` +
        `lex ${share(tally.lex.nonNull, tally.lex.clitic)}, spvar ${share(tally.spvar.nonNull, tally.spvar.clitic)}, ` +
        `both ${share(both, bothClitic)}; null: malformed lex ${tally.lex.malformed} spvar ${tally.spvar.malformed}, ` +
        `Letters differ lex ${tally.lex.lettersDiffer} spvar ${tally.spvar.lettersDiffer}`,
    );
  }, 300_000);
});
