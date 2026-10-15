// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The features Generator. It reads the Database_Pin and writes
// src/msa-features.ts: the pin's `ORDER` list as `MSA_FEATURE_NAMES`, every
// define whose value list is not `null` as `MSA_DEFINES` (name to values, in
// the pin's order), the types over them, and the guard `isMsaValue`. The
// module's header names this Generator, the pin (name, version, commit and
// SHA-256) and the Camel Morph attribution with its license, and points to
// NOTICE, whose row for the module is required by check:invariants.
//
// The source, in order of preference:
//   1. the text, data/camel-morph-msa/msa-v1.0.db (git-ignored), parsed with
//      flags `a`; its SHA-256 must equal the Source_Record's
//      (packages/shanisarf-db-msa/source.json), which names the pin;
//   2. the compiled Asset in packages/shanisarf-db-msa/asset/ (git-ignored),
//      loaded with flags `a`; the pin is named by its Provenance.
// With neither present it exits 1, naming both, and writes nothing.
//
// The output is a function of the pin alone: no date, no path, no machine.
// Running it twice writes byte-identical files, and the text and the Asset
// give the same file (a property test holds both).
//
// Like compile-db.mjs, it imports the engine and the loader from dist/
// (`npm run build` first). `--engine <dir>` names another tree of the same
// layout: a TypeScript tree such as src/ works under
// tests/support/ts-resolve-hook.mjs, which is how the property test reruns
// it without racing a build over dist/. It imports the engine and load
// entries, never the package root, so a missing or stale module cannot keep
// it from running.
//
// This is a new-design developer script: project header only, no ported-code
// notice.
//
// Usage:
//   npm run build
//   npm run gen:features                          # writes src/msa-features.ts
//   npm run gen:features -- --out <file>          # writes elsewhere
//   npm run gen:features -- --source asset        # the Asset even when the text is present
//   node --import ./tests/support/ts-resolve-hook.mjs scripts/gen-msa-features.mjs --engine src --out <file>
// Also: --db <path> and --asset <dir> name other locations for the text and
// the Asset.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(repoRoot, 'packages', 'shanisarf-db-msa');
const recordPath = join(pkgDir, 'source.json');

const VALUE_OPTIONS = ['--out', '--source', '--engine', '--db', '--asset'];

function fail(message, code = 1) {
  console.error(`\ngen:features — ${message}\n`);
  process.exit(code);
}

function readArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!VALUE_OPTIONS.includes(arg)) fail(`unknown argument ${arg}.`, 2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value.`, 2);
    options[arg.slice(2)] = value;
    i++;
  }
  if (options.source !== undefined && options.source !== 'text' && options.source !== 'asset') {
    fail('--source is `text` or `asset`.', 2);
  }
  return options;
}

// ---------------------------------------------------------------------------
// Rendering: a pure function of the pin's identity, order and defines.
// ---------------------------------------------------------------------------

const WIDTH = 80;

/** A TypeScript single-quoted literal; anything outside printable ASCII is escaped. */
function quote(s) {
  let out = "'";
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (ch === "'" || ch === '\\') out += `\\${ch}`;
    else if (cp >= 0x20 && cp < 0x7f) out += ch;
    else if (cp <= 0xffff) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else out += `\\u{${cp.toString(16)}}`;
  }
  return `${out}'`;
}

/** An object key: bare when it is an identifier, quoted otherwise. */
function key(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) ? name : quote(name);
}

/** Items joined with ", ", wrapped at WIDTH under `indent`, each line ending in a comma. */
function wrapItems(items, indent) {
  const lines = [];
  let line = '';
  for (const item of items) {
    const piece = `${item},`;
    if (line !== '' && indent.length + line.length + 1 + piece.length > WIDTH) {
      lines.push(indent + line);
      line = piece;
    } else {
      line = line === '' ? piece : `${line} ${piece}`;
    }
  }
  if (line !== '') lines.push(indent + line);
  return lines;
}

/** Words wrapped into `// ` comment lines at WIDTH. */
function commentLines(text) {
  const lines = [];
  let line = '//';
  for (const word of text.split(/[ \n]+/u).filter((w) => w !== '')) {
    if (line !== '//' && line.length + 1 + word.length > WIDTH) {
      lines.push(line);
      line = '//';
    }
    line += ` ${word}`;
  }
  if (line !== '//') lines.push(line);
  return lines;
}

/** The commit a Source_Record's or Provenance's `source` URL is pinned to. */
function commitOf(source) {
  const match = /\/blob\/([0-9a-f]{40})\//u.exec(source);
  if (match === null) fail(`the pin's source URL names no commit: ${source}`);
  return match[1];
}

/**
 * The module's text. `pin` is { name, version, source, sourceSha256, credits }
 * (a Source_Record or a Provenance), `order` the `ORDER` list and `defines`
 * the defines Map, in the pin's order.
 */
export function renderFeaturesModule(pin, order, defines) {
  if (order === null) fail('the pin has no ORDER section.');
  const closed = [...defines].filter(([, values]) => values !== null);
  if (!closed.some(([name]) => name === 'pos')) fail('the pin has no closed `pos` define, so `MsaPos` would not type.');

  const out = [
    '// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go',
    '// (https://github.com/shani-go), MIT License.',
    '//',
    ...commentLines(
      `Generated by scripts/gen-msa-features.mjs from ${pin.name} v${pin.version} ` +
        `(commit ${commitOf(pin.source)}, SHA-256 ${pin.sourceSha256}). ` +
        'Do not edit; run `npm run gen:features`.',
    ),
    '//',
    ...commentLines(
      `The feature names and value lists below are the database's ORDER and DEFINE lists. ${pin.credits} ` +
        'See NOTICE.',
    ),
    '//',
    ...commentLines(
      'The typed features module. It describes one database, not the engine: the ' +
        'package root exports it and the engine entry does not. Its only import is ' +
        'the Analysis type. New design: no ported-code notice.',
    ),
    '',
    "import type { Analysis } from './engine/analyzer.js';",
    '',
    `/** The pin's \`ORDER\` list: the ${order.length} feature names an analysis carries, in order. */`,
    'export const MSA_FEATURE_NAMES = [',
    ...wrapItems(order.map(quote), '  '),
    '] as const;',
    '',
    '/** A feature name of the pin. */',
    'export type MsaFeatureName = (typeof MSA_FEATURE_NAMES)[number];',
    '',
    `/** The pin's ${closed.length} closed sets: every define with a value list, name to values in the pin's order. */`,
    'export const MSA_DEFINES = {',
  ];
  for (const [name, values] of closed) {
    out.push(`  ${key(name)}: [`, ...wrapItems(values.map(quote), '    '), '  ],');
  }
  out.push(
    '} as const;',
    '',
    '/** The name of a closed set of the pin. */',
    'export type MsaDefineName = keyof typeof MSA_DEFINES;',
    '',
    '/** A value of the closed set `K`. */',
    'export type MsaValue<K extends MsaDefineName> = (typeof MSA_DEFINES)[K][number];',
    '',
    "/** A part-of-speech tag of the pin's `pos` set. */",
    "export type MsaPos = MsaValue<'pos'>;",
    '',
    '/**',
    ' * An Analysis over the pin: the same open record, with the pin\'s keys known to',
    ' * the type checker. A closed-set value stays `string`, since a special path may',
    ' * write one its set does not list; narrow it with `isMsaValue`.',
    ' */',
    'export type MsaAnalysis = Analysis & { readonly [K in MsaFeatureName]?: string | number | null };',
    '',
    '/** Whether `value` is a string in the closed set `name` (`false` for a name that is not one). */',
    'export function isMsaValue<K extends MsaDefineName>(name: K, value: unknown): value is MsaValue<K> {',
    '  if (typeof value !== \'string\' || !Object.prototype.hasOwnProperty.call(MSA_DEFINES, name)) return false;',
    '  return (MSA_DEFINES[name] as readonly string[]).includes(value);',
    '}',
    '',
  );
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Reading the pin and writing the module.
// ---------------------------------------------------------------------------

async function main() {
  const options = readArgs(process.argv.slice(2));
  const out = resolve(options.out ?? join(repoRoot, 'src', 'msa-features.ts'));
  const engineDir = resolve(options.engine ?? join(repoRoot, 'dist', 'esm'));
  const dbPath = resolve(options.db ?? join(repoRoot, 'data', 'camel-morph-msa', 'msa-v1.0.db'));
  const assetDir = resolve(options.asset ?? join(pkgDir, 'asset'));

  const haveText = existsSync(dbPath);
  const haveAsset = existsSync(join(assetDir, 'manifest.json'));
  const source = options.source ?? (haveText ? 'text' : 'asset');
  if (source === 'text' && !haveText) fail(`the Database_Pin text is not at ${dbPath}; nothing written.`);
  if (source === 'asset' && !haveAsset) {
    fail(
      [
        'neither source of the Database_Pin is present; nothing written.',
        `  text:  ${dbPath}${options.source === 'asset' ? ' (not asked for)' : ''}`,
        `  Asset: ${join(assetDir, 'manifest.json')}`,
        '  Fetch the database (`npm run parity:setup`) or compile the Asset (`npm run compile:db`).',
      ].join('\n'),
    );
  }

  const ext = existsSync(join(engineDir, 'engine', 'index.js')) ? '.js' : '.ts';
  const entry = (path) => join(engineDir, `${path}${ext}`);
  if (!existsSync(entry('engine/index')) || !existsSync(entry('load/index-node'))) {
    fail(`no built engine at ${engineDir}. Run \`npm run build\` first.`);
  }

  let pin;
  let db;
  if (source === 'text') {
    const bytes = readFileSync(dbPath);
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== record.sourceSha256) {
      fail(`${dbPath} has SHA-256 ${sha256}, not the pin's ${record.sourceSha256} (${recordPath}); nothing written.`);
    }
    const { parseAlmor } = await import(pathToFileURL(entry('engine/index')).href);
    db = parseAlmor(bytes.toString('utf8'), { flags: 'a' });
    pin = record;
  } else {
    const { loadDatabase } = await import(pathToFileURL(entry('load/index-node')).href);
    db = await loadDatabase(assetDir, { flags: 'a' });
    pin = db.provenance;
    if (pin === null) fail(`the Asset at ${assetDir} carries no Provenance.`);
  }

  const text = renderFeaturesModule(pin, db.order, db.defines);
  // Write beside the target and rename, so a failure leaves the old file whole.
  const temporary = `${out}.tmp-${process.pid}`;
  writeFileSync(temporary, text);
  renameSync(temporary, out);
  console.log(
    `gen:features — wrote ${out} from the ${source === 'text' ? 'text' : 'Asset'} ` +
      `(${db.order.length} feature names, ${[...db.defines.values()].filter((v) => v !== null).length} closed sets).`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
