// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests and a property for python-compat.ts: Python string semantics.
// PY_WHITESPACE is pinned to fixtures/meta/python-whitespace.json when that
// generated file exists, and the test fails if the constant and the fixture
// differ; without it, the constant is pinned against the list recorded here.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  PY_WHITESPACE,
  codePoints,
  pyLen,
  pyLines,
  pyRepr,
  pySplit,
  pySplitOn,
  pyStrip,
} from './python-compat.js';

// The 29 code points for which Python's str.isspace() is true. This is the
// fallback authority when fixtures/meta/python-whitespace.json is absent; the
// fixture, when present, supersedes it (see below).
const EXPECTED_PY_WHITESPACE: readonly string[] = [
  '\u0009', // CHARACTER TABULATION
  '\u000a', // LINE FEED
  '\u000b', // LINE TABULATION
  '\u000c', // FORM FEED
  '\u000d', // CARRIAGE RETURN
  '\u001c', // FILE SEPARATOR
  '\u001d', // GROUP SEPARATOR
  '\u001e', // RECORD SEPARATOR
  '\u001f', // UNIT SEPARATOR
  '\u0020', // SPACE
  '\u0085', // NEXT LINE
  '\u00a0', // NO-BREAK SPACE
  '\u1680', // OGHAM SPACE MARK
  '\u2000', // EN QUAD
  '\u2001', // EM QUAD
  '\u2002', // EN SPACE
  '\u2003', // EM SPACE
  '\u2004', // THREE-PER-EM SPACE
  '\u2005', // FOUR-PER-EM SPACE
  '\u2006', // SIX-PER-EM SPACE
  '\u2007', // FIGURE SPACE
  '\u2008', // PUNCTUATION SPACE
  '\u2009', // THIN SPACE
  '\u200a', // HAIR SPACE
  '\u2028', // LINE SEPARATOR
  '\u2029', // PARAGRAPH SEPARATOR
  '\u202f', // NARROW NO-BREAK SPACE
  '\u205f', // MEDIUM MATHEMATICAL SPACE
  '\u3000', // IDEOGRAPHIC SPACE
];

// The parity generator writes the whitespace set and the Python-side
// expected results for a seeded sample of strings into
// this file. We read it when present and treat it as the authority.
const FIXTURE_PATH = fileURLToPath(
  new URL('../../fixtures/meta/python-whitespace.json', import.meta.url),
);

interface WhitespaceFixture {
  // The code points for which Python str.isspace() is true, as a list of
  // single-code-point strings or as the raw code point values.
  whitespace: string[];
  // Optional seeded samples: Python's own str.strip / str.split results.
  samples?: Array<{
    input: string;
    strip: string;
    split: string[];
  }>;
}

function loadFixture(): WhitespaceFixture | null {
  if (!existsSync(FIXTURE_PATH)) {
    return null;
  }
  const raw = readFileSync(FIXTURE_PATH, 'utf8');
  return JSON.parse(raw) as WhitespaceFixture;
}

const fixture = loadFixture();

// The whitespace set the test pins against: the fixture's when it exists, the
// list above otherwise.
const expectedWhitespace: readonly string[] = fixture
  ? fixture.whitespace
  : EXPECTED_PY_WHITESPACE;

describe('PY_WHITESPACE', () => {
  it('equals the pinned whitespace set, code point for code point', () => {
    expect([...PY_WHITESPACE].sort()).toEqual([...expectedWhitespace].sort());
  });

  it('has exactly 29 members (Python str.isspace() for the BMP)', () => {
    expect(PY_WHITESPACE.size).toBe(29);
  });

  if (fixture) {
    it('matches fixtures/meta/python-whitespace.json exactly', () => {
      // Redundant with the pin above when the fixture is the authority, but
      // stated as its own assertion so a divergence names the fixture.
      const fromConstant = [...PY_WHITESPACE].sort();
      const fromFixture = [...fixture.whitespace].sort();
      expect(fromConstant).toEqual(fromFixture);
    });
  }
});

// A reference implementation of the Python semantics the port reproduces,
// built only on the pinned whitespace set. The property asserts the port
// agrees with this reference across many inputs; the reference is simple
// enough to read as obviously correct against Python's documented behavior.
const WS = new Set(expectedWhitespace);

function refStrip(s: string): string {
  const cps = Array.from(s);
  let start = 0;
  let end = cps.length;
  while (start < end && WS.has(cps[start] as string)) start++;
  while (end > start && WS.has(cps[end - 1] as string)) end--;
  return cps.slice(start, end).join('');
}

function refSplit(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const cp of Array.from(s)) {
    if (WS.has(cp)) {
      if (cur !== '') {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += cp;
    }
  }
  if (cur !== '') out.push(cur);
  return out;
}

describe('pyStrip', () => {
  it('removes leading and trailing Python whitespace runs', () => {
    expect(pyStrip('  a  b ')).toBe('a  b');
    expect(pyStrip('\t\n hi \r\n')).toBe('hi');
  });

  it('leaves interior whitespace untouched', () => {
    expect(pyStrip('a\tb')).toBe('a\tb');
  });

  it('returns empty for all-whitespace and empty strings', () => {
    expect(pyStrip('')).toBe('');
    expect(pyStrip(' \t\n\u00a0')).toBe('');
  });

  it('strips the non-ASCII members JavaScript trim would miss', () => {
    // U+001C FILE SEPARATOR is Python whitespace but not matched by \s in JS.
    expect(pyStrip('\u001ca\u001c')).toBe('a');
  });
});

describe('pySplit', () => {
  it('splits on whitespace runs and drops empties', () => {
    expect(pySplit('  a  b ')).toEqual(['a', 'b']);
  });

  it('returns [] for empty and all-whitespace strings', () => {
    expect(pySplit('')).toEqual([]);
    expect(pySplit('   \t\n ')).toEqual([]);
  });

  it('keeps a single token with no surrounding whitespace', () => {
    expect(pySplit('abc')).toEqual(['abc']);
  });
});

describe('pySplitOn', () => {
  it('keeps empty parts (Python str.split(sep))', () => {
    expect(pySplitOn('a::b', ':')).toEqual(['a', '', 'b']);
    expect(pySplitOn(':a:', ':')).toEqual(['', 'a', '']);
  });

  it('returns the whole string when the separator is absent', () => {
    expect(pySplitOn('abc', ':')).toEqual(['abc']);
  });

  it('returns [\'\'] for the empty string', () => {
    expect(pySplitOn('', ':')).toEqual(['']);
  });

  it('handles a multi-character separator', () => {
    expect(pySplitOn('a--b--c', '--')).toEqual(['a', 'b', 'c']);
    expect(pySplitOn('a----b', '--')).toEqual(['a', '', 'b']);
  });
});

describe('pyLines', () => {
  it('returns [] for the empty string', () => {
    expect(pyLines('')).toEqual([]);
  });

  it('drops the final empty segment left by a terminating newline', () => {
    expect(pyLines('a\nb\n')).toEqual(['a', 'b']);
  });

  it('keeps the final segment when there is no terminating newline', () => {
    expect(pyLines('a\nb')).toEqual(['a', 'b']);
  });

  it('treats \\r\\n, \\r and \\n alike', () => {
    expect(pyLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd']);
    expect(pyLines('a\r\nb\rc\nd\r\n')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('drops only the single final empty segment, preserving interior blanks', () => {
    expect(pyLines('a\n\nb\n')).toEqual(['a', '', 'b']);
    expect(pyLines('\na\n')).toEqual(['', 'a']);
  });

  it('yields one empty line for a lone terminator', () => {
    expect(pyLines('\n')).toEqual(['']);
    expect(pyLines('\r\n')).toEqual(['']);
  });
});

describe('codePoints and pyLen', () => {
  it('splits by code point, keeping astral characters whole', () => {
    // U+1F600 GRINNING FACE is one code point but two UTF-16 code units.
    expect(codePoints('a\u{1F600}b')).toEqual(['a', '\u{1F600}', 'b']);
    expect(pyLen('a\u{1F600}b')).toBe(3);
    expect('a\u{1F600}b'.length).toBe(4); // UTF-16 units, for contrast.
  });

  it('counts the empty string as zero', () => {
    expect(pyLen('')).toBe(0);
    expect(codePoints('')).toEqual([]);
  });
});

// Python string semantics.
describe('Python string semantics', () => {
  // A character set biased toward whitespace (every pinned member) and a
  // sample of other code points, so the property exercises both membership
  // outcomes densely.
  const otherSample = [
    'a',
    'z',
    'A',
    '0',
    '9',
    '-',
    ':',
    '.',
    '\u0627', // ARABIC LETTER ALEF
    '\u064e', // ARABIC FATHA
    '\u200b', // ZERO WIDTH SPACE (not Python whitespace)
    '\u{1F600}', // astral: GRINNING FACE
    '\u{1D11E}', // astral: MUSICAL SYMBOL G CLEF
  ];
  const alphabet = [...expectedWhitespace, ...otherSample];
  const charArb = fc.constantFrom(...alphabet);
  const strArb = fc.array(charArb, { maxLength: 24 }).map((cps) => cps.join(''));

  it('pyStrip, pySplit and membership agree with the reference', () => {
    fc.assert(
      fc.property(strArb, (s) => {
        expect(pyStrip(s)).toBe(refStrip(s));
        expect(pySplit(s)).toEqual(refSplit(s));
        for (const cp of Array.from(s)) {
          expect(PY_WHITESPACE.has(cp)).toBe(WS.has(cp));
        }
      }),
      { numRuns: 200 },
    );
  });

  it('pyLines agrees with the reference and treats terminators alike', () => {
    // A reference for Python text-mode line iteration: split on any of \r\n,
    // \r, \n, then drop a single trailing empty segment left by a terminating
    // newline; the empty string yields [].
    const refLines = (text: string): string[] => {
      if (text === '') return [];
      const parts = text.split(/\r\n|\r|\n/u);
      if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
      return parts;
    };
    // Build text from code points that include all three terminators, so the
    // generator explores terminating, non-terminating, and interior-blank
    // cases densely.
    const textChar = fc.constantFrom(...alphabet, '\r', '\n');
    const textArb = fc
      .array(textChar, { maxLength: 20 })
      .map((cps) => cps.join(''));
    fc.assert(
      fc.property(textArb, (text) => {
        expect(pyLines(text)).toEqual(refLines(text));
      }),
      { numRuns: 200 },
    );
  });

  it('pyLines treats \\r\\n, \\r and \\n as equivalent terminators', () => {
    // Lines with no interior terminator, joined with each terminator in turn,
    // yield the same segmentation.
    const lineArb = fc
      .array(charArb, { maxLength: 6 })
      .map((cps) => cps.filter((c) => c !== '\r' && c !== '\n').join(''));
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 1, maxLength: 8 }),
        fc.boolean(),
        (lines, trailing) => {
          const withLf = lines.join('\n') + (trailing ? '\n' : '');
          const withCr = lines.join('\r') + (trailing ? '\r' : '');
          const withCrLf = lines.join('\r\n') + (trailing ? '\r\n' : '');
          const a = pyLines(withLf);
          expect(pyLines(withCr)).toEqual(a);
          expect(pyLines(withCrLf)).toEqual(a);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('pySplitOn keeps empty parts and re-joins to the input', () => {
    const sepArb = fc.constantFrom(':', '-', '::', 'xy');
    fc.assert(
      fc.property(strArb, sepArb, (s, sep) => {
        const parts = pySplitOn(s, sep);
        // Joining the parts with the separator recovers the input exactly,
        // which is only true if empty parts are kept.
        expect(parts.join(sep)).toBe(s);
        // The number of parts is one more than the number of separators.
        expect(parts.length).toBe(s.split(sep).length);
      }),
      { numRuns: 200 },
    );
  });
});

describe('pyRepr', () => {
  // Expected strings are Python 3.14's `repr()` of the same values.
  it('single-quotes a plain string', () => {
    expect(pyRepr('xyz')).toBe("'xyz'");
  });

  it('switches to double quotes for a single quote without a double quote', () => {
    expect(pyRepr("it's")).toBe('"it\'s"');
  });

  it('escapes the single quote when both quotes occur', () => {
    expect(pyRepr('a\'b"c')).toBe("'a\\'b\"c'");
  });

  it('escapes the backslash and the tab, newline and carriage return', () => {
    expect(pyRepr('a\\b\tc\nd\re')).toBe("'a\\\\b\\tc\\nd\\re'");
  });

  it('prints null as None', () => {
    expect(pyRepr(null)).toBe('None');
  });
});
