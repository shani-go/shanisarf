// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for `cliticSegments`. Words and Scheme values are invented.

import { describe, expect, it } from 'vitest';

import type { Analysis } from '../engine/analyzer.js';
import { cliticSegments } from './clitic-segments.js';

// Letters and marks, named so the strings below read plainly.
const WAW = 'و';
const BEH = 'ب';
const KAF = 'ك';
const TEH = 'ت';
const ALEF = 'ا';
const ALEF_HAMZA = 'أ';
const HEH = 'ه';
const TEH_MARBUTA = 'ة';
const LAM = 'ل';
const MEEM = 'م';
const FATHA = 'َ';
const KASRA = 'ِ';
const DAMMA = 'ُ';
const SHADDA = 'ّ';
const SUKUN = 'ْ';
const TATWEEL = 'ـ';

const STEM = KAF + TEH + ALEF + BEH; // an invented stem of four Letters

function segs(word: string, value: unknown, scheme?: string) {
  const analysis = { [scheme ?? 'd3seg']: value } as Analysis;
  return cliticSegments(word, analysis, scheme === undefined ? undefined : { scheme });
}

describe('cliticSegments', () => {
  it('cuts two proclitics and an enclitic, keeping marks and tatweel with the Letter before them', () => {
    const word =
      WAW + FATHA + BEH + KASRA + KAF + TEH + TATWEEL + ALEF + BEH + KASRA + HEH + DAMMA + TATWEEL;
    const value = `${WAW + FATHA}+_${BEH + KASRA}+_${KAF + KASRA + TEH + ALEF + BEH + KASRA}_+${HEH + DAMMA}`;
    const out = segs(word, value);
    expect(out).toEqual([
      { role: 'proclitic', text: WAW + FATHA },
      { role: 'proclitic', text: BEH + KASRA },
      { role: 'stem', text: KAF + TEH + TATWEEL + ALEF + BEH + KASRA },
      { role: 'enclitic', text: HEH + DAMMA + TATWEEL },
    ]);
    expect(out?.map((s) => s.text).join('')).toBe(word);
  });

  it('matches Letters under the Fold (alef variants, teh marbuta)', () => {
    const word = ALEF_HAMZA + LAM + MEEM + TEH_MARBUTA;
    const out = segs(word, `${ALEF}${LAM}+_${MEEM + HEH}`);
    expect(out).toEqual([
      { role: 'proclitic', text: ALEF_HAMZA + LAM },
      { role: 'stem', text: MEEM + TEH_MARBUTA },
    ]);
  });

  it('puts the word\'s leading marks and tatweel in the first segment', () => {
    const word = TATWEEL + SHADDA + WAW + STEM;
    expect(segs(word, `${WAW}+_${STEM}`)).toEqual([
      { role: 'proclitic', text: TATWEEL + SHADDA + WAW },
      { role: 'stem', text: STEM },
    ]);
  });

  it('gives one stem equal to the word for a Scheme value with no +', () => {
    const word = KAF + FATHA + TEH + SUKUN + TATWEEL + ALEF + BEH;
    expect(segs(word, STEM)).toEqual([{ role: 'stem', text: word }]);
  });

  it('gives one stem for a special-path analysis whose d3seg is the word', () => {
    for (const word of ['123', 'abc', '،', '3.5']) {
      expect(segs(word, word)).toEqual([{ role: 'stem', text: word }]);
    }
  });

  it('drops empty parts', () => {
    expect(segs(WAW + STEM, `_${WAW}+__${STEM}_`)).toEqual([
      { role: 'proclitic', text: WAW },
      { role: 'stem', text: STEM },
    ]);
  });

  it('reads the Scheme named in options', () => {
    expect(segs(STEM + HEH, `${STEM}_+${HEH}`, 'atbseg')).toEqual([
      { role: 'stem', text: STEM },
      { role: 'enclitic', text: HEH },
    ]);
    // The default Scheme is absent here.
    expect(cliticSegments(STEM, { atbseg: STEM })).toBeNull();
  });

  it('skips a tatweel inside a Scheme piece on the Scheme side too', () => {
    const scheme = `${WAW}${TATWEEL}+_${KAF}${TATWEEL}${TEH}${ALEF}${BEH}`;
    expect(segs(WAW + STEM, scheme)).toEqual([
      { role: 'proclitic', text: WAW },
      { role: 'stem', text: STEM },
    ]);
  });

  it('returns null for a value that is not a string', () => {
    for (const value of [undefined, null, 3, 0]) {
      expect(segs(STEM, value)).toBeNull();
    }
  });

  it('returns null for a part with + at both ends, or a lone +', () => {
    expect(segs(WAW + STEM, `+${WAW}+_${STEM}`)).toBeNull();
    expect(segs(STEM, `+_${STEM}`)).toBeNull();
    expect(segs(STEM, '+')).toBeNull();
  });

  it('returns null for a piece with no Letter after dediacAr', () => {
    expect(segs(STEM, `${FATHA}+_${STEM}`)).toBeNull();
    expect(segs(STEM, `${STEM}_+${TATWEEL}`)).toBeNull();
    expect(segs(STEM, `${STEM}_+`)).toBeNull();
  });

  it('returns null for other than exactly one stem', () => {
    expect(segs(STEM + HEH, `${STEM}_${HEH}`)).toBeNull();
    expect(segs(WAW + HEH, `${WAW}+_+${HEH}`)).toBeNull();
    expect(segs('', '')).toBeNull();
  });

  it('returns null when a Letter is changed, dropped or added', () => {
    expect(segs(WAW + STEM, `${WAW}+_${KAF + TEH + ALEF + MEEM}`)).toBeNull();
    expect(segs(WAW + STEM, `${WAW}+_${KAF + TEH + ALEF}`)).toBeNull();
    expect(segs(WAW + STEM, `${WAW}+_${STEM + HEH}`)).toBeNull();
    expect(segs(STEM, `${WAW}+_${STEM}`)).toBeNull();
  });

  it('never changes a frozen analysis or reads past the Scheme', () => {
    const analysis = Object.freeze({ d3seg: `${WAW}+_${STEM}`, diac: STEM, pos: 'noun' });
    const before = JSON.stringify(analysis);
    expect(cliticSegments(WAW + STEM, analysis)).toEqual([
      { role: 'proclitic', text: WAW },
      { role: 'stem', text: STEM },
    ]);
    expect(JSON.stringify(analysis)).toBe(before);
  });

  it('throws TypeError for a non-string word or a non-object analysis', () => {
    expect(() => cliticSegments(3 as unknown as string, { d3seg: STEM })).toThrow(TypeError);
    expect(() => cliticSegments(STEM, null as unknown as Analysis)).toThrow(TypeError);
    expect(() => cliticSegments(STEM, STEM as unknown as Analysis)).toThrow(TypeError);
  });
});
