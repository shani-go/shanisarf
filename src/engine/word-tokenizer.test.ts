// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the word tokenizer: a few concrete tokenizations against CAMeL
// Tools' `simple_word_tokenize`, so whitespace splitting, punctuation peeling,
// digit splitting, the emoji approximation and code-point handling are
// visible. The word-tokenizer property proves the general claims. The ASCII
// examples are the ones in upstream's own docstring; the Arabic and emoji words
// are invented or built from the character sets.
import { describe, expect, it } from 'vitest';

import {
  EMOJI_APPROXIMATION_BOUND,
  simpleWordTokenize,
} from './word-tokenizer.js';

describe('simpleWordTokenize', () => {
  it('splits on whitespace and peels trailing punctuation (upstream docstring)', () => {
    // Upstream: 'Hello,    world!!!' -> ['Hello', ',', 'world', '!', '!', '!']
    expect(simpleWordTokenize('Hello,    world!!!')).toEqual([
      'Hello',
      ',',
      'world',
      '!',
      '!',
      '!',
    ]);
  });

  it('keeps digits attached to the run when splitDigits is false', () => {
    // Without split_digits, 'world123!!!' keeps the digits in the word.
    expect(simpleWordTokenize('Hello,    world123!!!')).toEqual([
      'Hello',
      ',',
      'world123',
      '!',
      '!',
      '!',
    ]);
  });

  it('splits maximal digit runs when splitDigits is true (upstream docstring)', () => {
    // Upstream: 'Hello,    world123!!!' with split_digits ->
    //   ['Hello', ',', 'world', '123', '!', '!', '!']
    expect(simpleWordTokenize('Hello,    world123!!!', true)).toEqual([
      'Hello',
      ',',
      'world',
      '123',
      '!',
      '!',
      '!',
    ]);
  });

  it('returns no tokens for empty or whitespace-only input', () => {
    expect(simpleWordTokenize('')).toEqual([]);
    expect(simpleWordTokenize('   \t\n')).toEqual([]);
  });

  it('produces no empty tokens and no whitespace in any token', () => {
    const tokens = simpleWordTokenize('  a, b!!  c#d  ', true);
    for (const t of tokens) {
      expect(t.length).toBeGreaterThan(0);
      expect(pySplitLikeHasNoSpace(t)).toBe(true);
    }
  });

  it('tokens concatenate back to the input with whitespace removed', () => {
    const inputs = [
      'abc, def! 123',
      'سلام، عالم!',
      'a1b2c3',
      '!@#$%',
      '  leading and trailing   ',
    ];
    for (const input of inputs) {
      const noWs = input.replace(/[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/gu, '');
      expect(simpleWordTokenize(input).join('')).toBe(noWs);
      expect(simpleWordTokenize(input, true).join('')).toBe(noWs);
    }
  });

  it('peels a single Unicode punctuation code point as its own token', () => {
    // Arabic comma U+060C and Arabic full stop are \p{P}.
    expect(simpleWordTokenize('كلمة،أخرى')).toEqual(['كلمة', '،', 'أخرى']);
  });

  it('peels a single symbol code point as its own token', () => {
    // '$' and '%' are \p{S} (currency / math-symbol-adjacent category So/Sc).
    expect(simpleWordTokenize('a$b')).toEqual(['a', '$', 'b']);
  });

  it('emits a multi-code-point emoji sequence as one token (emoji approximation)', () => {
    // A flag is a regional-indicator pair (two astral code points): one token.
    const flag = '\u{1F1FA}\u{1F1F8}'; // 🇺🇸
    expect(simpleWordTokenize('x' + flag + 'y')).toEqual(['x', flag, 'y']);
  });

  it('does not split a bare decimal digit as a symbol (digits are not P/S)', () => {
    // '0'..'9' match \p{Emoji} in the UTS #51 pattern but are neither \p{P}
    // nor \p{S}; the approximation rejects the single-code-point match, so a
    // bare digit stays in the alphanumeric run (matching upstream).
    expect(simpleWordTokenize('a5b')).toEqual(['a5b']);
  });

  it('records the emoji approximation bound', () => {
    expect(EMOJI_APPROXIMATION_BOUND).toContain('emoji string');
    expect(EMOJI_APPROXIMATION_BOUND).toContain('P/S code point');
  });
});

/** True when a token holds no ASCII space or tab (sanity for the no-ws claim). */
function pySplitLikeHasNoSpace(token: string): boolean {
  return !/[ \t\n\r\v\f]/u.test(token);
}
