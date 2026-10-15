// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Placed marks change nothing but marks. Over mark-free words (tatweel
// allowed) and diacs built from their Letters (random marks, leading marks,
// Fold-class swaps, tatweels anywhere), `placeMarks` equals the placement the
// test computes: leading marks first, each Letter followed by the marks that
// followed it in the diac, a diac tatweel placed nowhere; so
// `dediacAr(result) === word`. A word with any mark, or a diac whose Letters
// differ, gives `null`. Over the Database_Pin (skipped without `data/`): every
// Lexical_Analysis of every mark-free `db-forms` word places exactly when its
// `diac` carries no underscore (55,729 place, 12 do not).

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { placeMarks } from '../../src/align/vowel-marks.js';
import { dediacAr } from '../../src/engine/dediac.js';
import {
  HAVE_PIN,
  TATWEEL,
  diacFormArb,
  expectedRender,
  isLetter,
  isMark,
  letterArb,
  markFreeWordArb,
  marksOf,
  otherLetter,
  pinLexicalAnalyses,
  share,
  wordArb,
  writeDiac,
} from './align-support.js';

const NUM_RUNS = 200;

const count = (s: string, ch: string): number => Array.from(s).filter((c) => c === ch).length;

const wordAndForm = markFreeWordArb.chain((word) => diacFormArb(word).map((form) => ({ word, form })));

describe('placed marks change nothing but marks', () => {
  it('places a diac built from the word\'s Letters, changing nothing but marks', () => {
    fc.assert(
      fc.property(wordAndForm, ({ word, form }) => {
        const result = placeMarks(word, form.diac);
        expect(result, `diac ${JSON.stringify(form.diac)}`).not.toBeNull();
        if (result === null) return;
        expect(result).toBe(expectedRender(word, form.lead, form.after));
        expect(dediacAr(result)).toBe(word);
        expect(marksOf(result)).toBe(marksOf(form.diac));
        expect(result.startsWith(form.lead)).toBe(true);
        expect(count(result, TATWEEL)).toBe(count(word, TATWEEL));
      }),
      { numRuns: NUM_RUNS },
    );
  }, 60_000);

  it('gives null for a word that carries a mark', () => {
    const marked = wordArb(true).filter((w) => Array.from(w).some(isMark));
    fc.assert(
      fc.property(
        marked.chain((word) => diacFormArb(word).map((form) => ({ word, form }))),
        ({ word, form }) => {
          expect(placeMarks(word, form.diac), JSON.stringify(word)).toBeNull();
          // The diac with no marks at all places nowhere on a marked word either.
          expect(placeMarks(word, Array.from(word).filter(isLetter).join(''))).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  }, 60_000);

  it('gives null when the diac\'s Letters differ from the word\'s', () => {
    fc.assert(
      fc.property(
        wordAndForm,
        fc.constantFrom('change', 'drop', 'add'),
        fc.nat(),
        fc.nat(),
        letterArb,
        ({ word, form }, kind, pick, pick2, extra) => {
          const letters = form.letters.slice();
          const after = form.after.slice();
          const j = pick % letters.length;
          if (kind === 'change') {
            letters[j] = otherLetter(letters[j] as string, pick2);
          } else if (kind === 'drop') {
            letters.splice(j, 1);
            after.splice(j, 1);
          } else {
            letters.splice(j + (pick2 % 2), 0, extra);
            after.splice(j + (pick2 % 2), 0, '');
          }
          const diac = writeDiac(form.lead, letters, after, new Set());
          expect(placeMarks(word, diac), `${kind}: ${JSON.stringify(diac)}`).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  }, 60_000);
});

const describePin = HAVE_PIN ? describe : describe.skip;
if (!HAVE_PIN) {
  console.warn('vowel-marks pin case skipped: the Database_Pin is not under data/ (npm run parity:setup).');
}

describePin('placed marks over the pin (the placeMarks gate)', () => {
  it('places every Lexical_Analysis whose diac has no underscore, and none that has one', () => {
    const tally = {
      lex: { placed: 0, plain: 0, underscored: 0, underscoredNull: 0 },
      spvar: { placed: 0, plain: 0, underscored: 0, underscoredNull: 0 },
    };
    const failures: string[] = [];
    for (const { word, analysis, source } of pinLexicalAnalyses()) {
      const diac = analysis['diac'];
      expect(typeof diac).toBe('string');
      if (typeof diac !== 'string') continue;
      const result = placeMarks(word, diac);
      const t = tally[source];
      if (diac.includes('_')) {
        t.underscored += 1;
        if (result === null) t.underscoredNull += 1;
        else failures.push(`${source} ${word} ${diac}: placed despite the underscore`);
      } else {
        t.plain += 1;
        if (result !== null && dediacAr(result) === word && marksOf(result) === marksOf(diac)) t.placed += 1;
        else failures.push(`${source} ${word} ${diac}: ${String(result)}`);
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    const plain = tally.lex.plain + tally.spvar.plain;
    const placed = tally.lex.placed + tally.spvar.placed;
    const underscored = tally.lex.underscored + tally.spvar.underscored;
    expect(plain).toBeGreaterThan(0);
    expect(placed).toBe(plain);
    expect(tally.lex.underscoredNull + tally.spvar.underscoredNull).toBe(underscored);
    console.log(
      `vowel-marks pin: placeMarks non-null among Lexical_Analyses without an underscore in diac: ` +
        `lex ${share(tally.lex.placed, tally.lex.plain)}, spvar ${share(tally.spvar.placed, tally.spvar.plain)}, ` +
        `both ${share(placed, plain)}; null for the underscored: lex ${tally.lex.underscoredNull} of ` +
        `${tally.lex.underscored}, spvar ${tally.spvar.underscoredNull} of ${tally.spvar.underscored}`,
    );
  }, 300_000);
});
