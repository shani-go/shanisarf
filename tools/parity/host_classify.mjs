// shanisarf parity harness. Copyright 2026 shani-go (https://github.com/shani-go), MIT License.
//
// Host-side word classifier for the Generator's Unicode_Drift check. The
// Generator (tools/parity/generate.py) spawns this once, feeds it the fixture
// words as JSON on stdin, and reads back each word's analyzer branch as the
// JavaScript host (Node's V8 + ICU) classifies it. A word whose host branch
// differs from CAMeL Tools' branch is Unicode_Drift and goes into the
// fixture's `knownDrift` list.
//
// It reproduces the port's own classification exactly (src/engine/analyzer.ts
// and src/engine/python-compat.ts): `pyStrip` with Python_Whitespace, then the
// five branch predicates in the order digit, punc, has-punc, foreign, lexical.
// The regexes are the port's, translated literally with the `u` flag:
//
//   IS_STRICT_DIGIT   /^[0-9\u0660-\u0669]+$/u
//   IS_DIGIT          /^.*[0-9\u0660-\u0669]+.*$/u
//   IS_PUNC           /^[\p{P}\p{S}]+$/u
//   HAS_PUNC          /[\p{P}\p{S}]/u
//   IS_AR             /^[<AR_CHARSET>]+$/u
//
// The only place the two Unicode versions can disagree is `\p{P}` / `\p{S}`
// (the host's ICU against CAMeL Tools' unicodedata): that is where drift
// lives, and this script is how the Generator sees the host's answer. The
// Arabic class and the digit ranges are fixed code points, so they never
// drift; they are reproduced here only so the branch order is faithful.
//
// Why a committed script and not `node -e` with the regexes inlined: the
// Python_Whitespace set and the Arabic character class are long literal lists
// that must match the engine code point for code point. A reviewed file keeps
// them readable and lets a reader check them against src/engine/; an inlined
// one-liner would not. The classifier intentionally depends on nothing under
// src/engine/ (the engine's public entry does not export the branch
// predicates, and dist/ need not be built to generate fixtures), so it holds
// its own faithful copy of those fixed constants.
//
// New-design file: project header only, no ported-code notice.
//
// Protocol: read a single JSON array of strings from stdin; write a single
// JSON array of branch labels to stdout, one per input, in order. A label is
// one of "empty", "digit", "punc", "haspunc", "foreign", "lexical". The digit
// branch depends on strictDigit, which arrives as --strict on argv.

// The 29 Python_Whitespace code points (src/engine/python-compat.ts
// PY_WHITESPACE). pyStrip trims runs of these from both ends.
const PY_WHITESPACE = new Set([
  '\u0009', '\u000a', '\u000b', '\u000c', '\u000d', '\u001c', '\u001d',
  '\u001e', '\u001f', '\u0020', '\u0085', '\u00a0', '\u1680', '\u2000',
  '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2007',
  '\u2008', '\u2009', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f',
  '\u3000',
]);

// The Arabic character class (src/engine/charsets.ts AR_CHARSET): the 42
// letters plus the 9 diacritics, as the inside of a `[...]` class. These are
// fixed code points, so IS_AR never drifts between Unicode versions.
const AR_LETTERS =
  '\u0621\u0622\u0623\u0624\u0625\u0626\u0627' +
  '\u0628\u0629\u062a\u062b\u062c\u062d\u062e' +
  '\u062f\u0630\u0631\u0632\u0633\u0634\u0635' +
  '\u0636\u0637\u0638\u0639\u063a\u0640\u0641' +
  '\u0642\u0643\u0644\u0645\u0646\u0647\u0648' +
  '\u0649\u064a\u0671\u067e\u0686\u06a4\u06af';
const AR_DIAC = '\u064b\u064c\u064d\u064e\u064f\u0650\u0651\u0652\u0670';
const AR_CLASS = AR_LETTERS + AR_DIAC; // no class metacharacter among these

const IS_STRICT_DIGIT = /^[0-9\u0660-\u0669]+$/u;
const IS_DIGIT = /^.*[0-9\u0660-\u0669]+.*$/u;
const IS_PUNC = /^[\p{P}\p{S}]+$/u;
const HAS_PUNC = /[\p{P}\p{S}]/u;
// AR_CLASS is a deliberate faithful copy of src/engine/charsets.ts's AR class,
// combining diacritics (AR_DIAC) intentionally included; the combined chars are
// correct here, not misleading.
// eslint-disable-next-line no-misleading-character-class
const IS_AR = new RegExp(`^[${AR_CLASS}]+$`, 'u');

/** Python `str.strip()`: trim runs of Python_Whitespace from both ends. */
function pyStrip(s) {
  const cps = Array.from(s);
  let start = 0;
  let end = cps.length;
  while (start < end && PY_WHITESPACE.has(cps[start])) start++;
  while (end > start && PY_WHITESPACE.has(cps[end - 1])) end--;
  return cps.slice(start, end).join('');
}

/**
 * The analyzer branch a word takes, as the host classifies it. Mirrors
 * src/engine/analyzer.ts `computeAnalyses`: strip first (empty → "empty"),
 * then the first matching branch of digit, punc, has-punc, foreign, else
 * lexical. `strictDigit` selects IS_STRICT_DIGIT over IS_DIGIT.
 */
function classify(word, strictDigit) {
  const stripped = pyStrip(word);
  if (stripped === '') return 'empty';
  if (
    (strictDigit && IS_STRICT_DIGIT.test(stripped)) ||
    (!strictDigit && IS_DIGIT.test(stripped))
  ) {
    return 'digit';
  }
  if (IS_PUNC.test(stripped)) return 'punc';
  if (HAS_PUNC.test(stripped)) return 'haspunc';
  if (!IS_AR.test(stripped)) return 'foreign';
  return 'lexical';
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const strictDigit = process.argv.includes('--strict');
  const raw = await readStdin();
  const words = JSON.parse(raw);
  if (!Array.isArray(words)) {
    process.stderr.write('host_classify: stdin must be a JSON array of strings\n');
    process.exit(2);
  }
  const labels = words.map((w) => classify(w, strictDigit));
  process.stdout.write(JSON.stringify(labels));
}

main().catch((err) => {
  process.stderr.write(`host_classify: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
