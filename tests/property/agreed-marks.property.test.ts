// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Agreement keeps only what every form puts there. Over mark-free words and
// non-empty lists of diacs, each list drawn as variations of one base form (a
// position kept, its marks reversed, replaced or dropped): `agreedMarks` is the
// word with, at the start and after each Letter, the sequence every form has
// there or none; one form equals `placeMarks`; the result ignores the order of
// the forms and repeats; adding a form never adds a mark; a form whose Letters
// differ, or an empty list, gives `null`; and when no mark agrees the result
// is the word itself, not `null`.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { agreedMarks, placeMarks } from '../../src/align/vowel-marks.js';
import {
  MARKS,
  diacFormArb,
  expectedRender,
  isLetter,
  markFreeWordArb,
  markSeqArb,
  otherLetter,
  readPositions,
  writeDiac,
  type DiacForm,
} from './align-support.js';

const NUM_RUNS = 200;

type Op = 'same' | 'reverse' | 'replace' | 'drop';

/** One form's variation of the base: an op per position (lead first). */
interface Variation {
  ops: Op[];
  replacements: string[];
  tatweelAt: number[];
}

function apply(op: Op, base: string, replacement: string): string {
  switch (op) {
    case 'same':
      return base;
    case 'reverse':
      return Array.from(base).reverse().join('');
    case 'replace':
      return replacement;
    case 'drop':
      return '';
  }
}

interface Form {
  lead: string;
  after: string[];
  diac: string;
}

function vary(base: DiacForm, v: Variation): Form {
  const seqs = [base.lead, ...base.after].map((s, i) => apply(v.ops[i] ?? 'same', s, v.replacements[i] ?? ''));
  const lead = seqs[0] ?? '';
  const after = seqs.slice(1);
  return { lead, after, diac: writeDiac(lead, base.letters, after, new Set(v.tatweelAt)) };
}

function variationArb(positions: number): fc.Arbitrary<Variation> {
  return fc.record({
    ops: fc.array(fc.constantFrom<Op>('same', 'same', 'reverse', 'replace', 'drop'), {
      minLength: positions,
      maxLength: positions,
    }),
    replacements: fc.array(markSeqArb, { minLength: positions, maxLength: positions }),
    tatweelAt: fc.uniqueArray(fc.nat({ max: 3 * positions }), { maxLength: 2 }),
  });
}

interface Case {
  word: string;
  base: DiacForm;
  forms: Form[];
  extra: Form;
}

const caseArb: fc.Arbitrary<Case> = markFreeWordArb.chain((word) =>
  diacFormArb(word).chain((base) => {
    const positions = base.letters.length + 1;
    return fc
      .record({
        variations: fc.array(variationArb(positions), { minLength: 1, maxLength: 4 }),
        extra: variationArb(positions),
      })
      .map(({ variations, extra }) => ({
        word,
        base,
        forms: variations.map((v) => vary(base, v)),
        extra: vary(base, extra),
      }));
  }),
);

/** The test's own agreement: per position, the common sequence or none. */
function expectedAgreement(word: string, forms: readonly Form[]): string {
  const first = forms[0] as Form;
  const lead = forms.every((f) => f.lead === first.lead) ? first.lead : '';
  const after = first.after.map((s, k) => (forms.every((f) => f.after[k] === s) ? s : ''));
  return expectedRender(word, lead, after);
}

describe('agreement keeps only what every form puts there', () => {
  it('keeps at each position the sequence every form has there, and nothing else', () => {
    fc.assert(
      fc.property(caseArb, fc.nat(), ({ word, forms, extra }, pick) => {
        const diacs = forms.map((f) => f.diac);
        const result = agreedMarks(word, diacs);
        expect(result, JSON.stringify(diacs)).not.toBeNull();
        if (result === null) return;
        expect(result).toBe(expectedAgreement(word, forms));

        // One form is placeMarks.
        for (const d of diacs) {
          expect(agreedMarks(word, [d])).toBe(placeMarks(word, d));
        }

        // Order and repeats do not matter.
        expect(agreedMarks(word, diacs.slice().reverse())).toBe(result);
        const rotated = diacs.slice(pick % diacs.length).concat(diacs.slice(0, pick % diacs.length));
        expect(agreedMarks(word, rotated)).toBe(result);
        expect(agreedMarks(word, [...diacs, diacs[pick % diacs.length] as string])).toBe(result);

        // Adding a form never adds a mark: each position keeps its sequence or empties.
        const more = agreedMarks(word, [...diacs, extra.diac]);
        expect(more).not.toBeNull();
        if (more === null) return;
        const before = readPositions(result);
        const after = readPositions(more);
        expect(after.lead === before.lead || after.lead === '', 'lead').toBe(true);
        expect(after.after).toHaveLength(before.after.length);
        after.after.forEach((s, k) => {
          expect(s === before.after[k] || s === '', `position ${k}`).toBe(true);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  }, 60_000);

  it('gives null for a form whose Letters differ, or for an empty list', () => {
    fc.assert(
      fc.property(caseArb, fc.nat(), fc.nat(), ({ word, base, forms }, pick, pick2) => {
        const letters = base.letters.slice();
        const j = pick % letters.length;
        letters[j] = otherLetter(letters[j] as string, pick2);
        const bad = writeDiac(base.lead, letters, base.after, new Set());
        const diacs = forms.map((f) => f.diac);
        diacs.splice(pick2 % (diacs.length + 1), 0, bad);
        expect(agreedMarks(word, diacs)).toBeNull();
        expect(agreedMarks(word, [])).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  }, 60_000);

  it('returns the word itself, not null, when no mark agrees', () => {
    fc.assert(
      fc.property(
        markFreeWordArb,
        fc.uniqueArray(fc.constantFrom(...MARKS), { minLength: 2, maxLength: 2 }),
        fc.boolean(),
        (word, [m1, m2], withLead) => {
          const letters = Array.from(word).filter(isLetter);
          const lead1 = withLead ? (m1 as string) : '';
          const lead2 = withLead ? (m2 as string) : '';
          const d1 = writeDiac(lead1, letters, letters.map(() => m1 as string), new Set());
          // The same marks in another order at every position, and a different one.
          const d2 = writeDiac(lead2, letters, letters.map(() => `${m2 as string}${m1 as string}`), new Set());
          const d3 = writeDiac(lead1, letters, letters.map(() => `${m1 as string}${m2 as string}`), new Set());
          expect(agreedMarks(word, [d1, d2])).toBe(word);
          expect(agreedMarks(word, [d2, d3])).toBe(word);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  }, 60_000);
});
