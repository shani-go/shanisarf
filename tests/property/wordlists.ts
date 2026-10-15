// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Readers for the committed Word_Lists and Request_Lists under
// `fixtures/wordlists/`, shared by the property tests.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Absolute path to the committed `fixtures/wordlists/` directory. */
export const WORDLISTS_DIR = fileURLToPath(
  new URL('../../fixtures/wordlists', import.meta.url),
);

/**
 * Read a Word_List's words: split on `\n` only, drop the final empty segment a
 * terminating newline leaves, and drop the `#` header lines — the convention
 * of the Fixture_Generator's `_load_wordlist_words` (tools/parity/generate.py)
 * and of the backoff-nesting property's reader. A blank line is kept as the empty string.
 */
export function loadWordlistWords(name: string): string[] {
  const lines = readFileSync(`${WORDLISTS_DIR}/${name}.words.txt`, 'utf8').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.filter((line) => !line.startsWith('#'));
}

/** One Request_List line. */
export interface RequestLine {
  lemma?: string;
  word?: string;
  feats: Record<string, string>;
}

/**
 * Read a Request_List (`<name>.requests.jsonl`): skip the `#` header line,
 * parse each remaining line as one JSON object.
 */
export function loadRequestList(name: string): RequestLine[] {
  return readFileSync(`${WORDLISTS_DIR}/${name}.requests.jsonl`, 'utf8')
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => JSON.parse(line) as RequestLine);
}
