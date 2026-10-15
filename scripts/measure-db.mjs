// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Measure the text-loaded Database_Pin: it parses the Camel Morph MSA v1.0
// database with `parseAlmor`, asserts the expected table counts for the
// pinned database, and records the TypeScript-side runtime measurements —
// parse time, heap after parse and parse throughput — stamped with the Node
// version and the date.
//
// The Database_Pin is the ~85 MB Camel Morph MSA v1.0 file. It is CC BY 4.0
// and NEVER committed (see NOTICE and the hard invariants in CONTRIBUTING.md):
// it is fetched to the git-ignored data/ by the developer-invoked
// `npm run parity:setup` (which runs tools/parity/fetch_db.py, the only
// network call in the repo). When the database is absent this script
// skip-with-notices and exits 0 — exactly as the parity replay suite skips
// when data/ lacks the file — so it never fails the build.
//
// This is a new-design developer script: project header only, no ported-code
// notice.
//
// Usage:
//   npm run build            # build the engine so dist/esm/ exists
//   npm run parity:setup     # fetch the Database_Pin into data/ (developer)
//   npm run measure:db       # parse, assert the counts, print measurements
//
// The counts are read through `db.counts()`, which materializes nothing,
// together with the tuple model's Layout counts (17 stem, 11 prefix, 6
// suffix).
//
// `--flags r` parses with the reinflection flag instead, and also asserts the
// expected counts of the generation tables:
//   npm run measure:db -- --flags r
//
// Memory method. The script runs under `node --expose-gc` (the npm script
// passes it). After the parse it collects twice with the source string still
// referenced, then drops its own reference to the source, collects twice
// more, and records `heapUsed`, `external`, `arrayBuffers`, `rss` and
// Retained_Memory, which is `heapUsed + external`. Node's `external` already
// includes `arrayBuffers`, so the sum counts each byte once; `arrayBuffers`
// is reported beside it. Node keeps a large string read with
// `readFileSync(path, 'utf8')` outside the heap, in `external`, so `heapUsed`
// alone never shows what the model still pins of its source. The "source
// referenced" figures are printed for comparison; the "source dropped"
// figures are the ones recorded.
//
// The retention bound: it also measures Retained_Memory just before and just
// after reading the file, so the difference is what the source string itself
// occupies (Node counts a string read from a UTF-8 file at one byte per code
// unit), and fails (exit 1) unless dropping the source frees at least 90% of
// that while the model is referenced. Nothing here runs a regular expression
// over the source: V8 keeps the last RegExp subject alive for the legacy
// `RegExp.input`.
//
// With `--json` the script prints one JSON object to stdout instead of its
// report (notices and failures still go to stderr, and the exit code is
// unchanged). `npm run bench` runs it that way, in a process of its own.
//
// Asset mode: `--asset <dir>` loads a compiled Asset through the built Node
// entry's `loadDatabase` (dist/esm/index-node.js) instead of parsing the
// text, with `--flags a` or `r`, and records the same memory fields by the
// same method (no source string exists to drop) and the load time, and
// asserts the same counts. It needs no Database_Pin, only the Asset
// (`npm run compile:db` builds it into packages/shanisarf-db-msa/asset/):
//   npm run measure:db -- --asset packages/shanisarf-db-msa/asset
//   npm run measure:db -- --asset packages/shanisarf-db-msa/asset --flags r

import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = join(repoRoot, 'data', 'camel-morph-msa', 'msa-v1.0.db');
const builtParser = join(repoRoot, 'dist', 'esm', 'engine', 'almor-parser.js');
const builtNodeEntry = join(repoRoot, 'dist', 'esm', 'index-node.js');

// Distinct, non-fatal exit code used for the skip-with-notice path, so a
// caller can tell "database absent, skipped" apart from "ran and passed" (0)
// and from "ran and an assertion failed" (1). The build must not fail on this
// code: npm scripts treat only a non-zero status as failure, so the script
// returns 0 for the skip to keep CI green (mirroring the parity suite's
// test.skip), while still printing the notice loudly.
const SKIP_EXIT = 0;

// The expected table counts for the pinned database. These are the targets
// this script asserts; they are measured facts about the Database_Pin, not
// runtime numbers.
const EXPECTED = {
  prefixSurfaces: 383,
  prefixEntries: 12_724,
  maxPrefixSize: 7,
  suffixSurfaces: 1_557,
  suffixEntries: 15_044,
  maxSuffixSize: 9,
  stemSurfaces: 96_989,
  stemEntries: 175_972,
  tablePairsAB: 4_332,
  tablePairsBC: 9_059,
  tablePairsAC: 1_432,
};

// The Layout counts of the tuple model, asserted under both flags.
const EXPECTED_LAYOUTS = {
  prefixLayouts: 11,
  suffixLayouts: 6,
  stemLayouts: 17,
};

// The expected counts of the generation tables, asserted under `--flags r`.
const EXPECTED_GENERATION = {
  prefixCategories: 221,
  prefixRecords: 12_724,
  suffixCategories: 543,
  suffixRecords: 15_044,
  lemmas: 100_906,
  lemmaStems: 175_972,
  stemPrefixCategories: 418,
  stemPrefixPairs: 4_332,
};

function assertEqual(label, actual, expected, failures) {
  const ok = actual === expected;
  const mark = ok ? 'ok  ' : 'FAIL';
  console.log(
    `  [${mark}] ${label}: ${actual.toLocaleString('en-US')}` +
      (ok ? '' : ` (expected ${expected.toLocaleString('en-US')})`),
  );
  if (!ok) {
    failures.push(
      `${label}: got ${actual.toLocaleString('en-US')}, expected ` +
        `${expected.toLocaleString('en-US')}`,
    );
  }
  return ok;
}

function skipWithNotice() {
  console.error(
    [
      '',
      'measure:db — SKIPPED: the Database_Pin is not present.',
      '',
      `  expected at: ${dbPath}`,
      '',
      '  The Camel Morph MSA v1.0 database is CC BY 4.0 and is never committed',
      '  or packaged (see NOTICE and the hard invariants in CONTRIBUTING.md).',
      '  Fetch it, then run the measurement:',
      '',
      '      npm run parity:setup      # fetches the DB into data/ (developer)',
      '      npm run measure:db        # parse, assert counts, record measurements',
      '',
      '  This is not a failure; the build is unaffected.',
      '',
    ].join('\n'),
  );
  process.exit(SKIP_EXIT);
}

/** `process.memoryUsage()` after two full collections, in MiB. */
function collectAndMeasure() {
  globalThis.gc();
  globalThis.gc();
  const mem = process.memoryUsage();
  const toMiB = (bytes) => bytes / (1024 * 1024);
  return {
    heapUsedMiB: toMiB(mem.heapUsed),
    externalMiB: toMiB(mem.external),
    arrayBuffersMiB: toMiB(mem.arrayBuffers),
    rssMiB: toMiB(mem.rss),
    retainedMiB: toMiB(mem.heapUsed + mem.external),
  };
}

function printMemory(label, m) {
  console.log(`  ${label}:`);
  console.log(`    Retained_Memory (heapUsed + external): ${m.retainedMiB.toFixed(1)} MiB`);
  console.log(`    heapUsed:     ${m.heapUsedMiB.toFixed(1)} MiB`);
  console.log(`    external:     ${m.externalMiB.toFixed(1)} MiB`);
  console.log(`    arrayBuffers: ${m.arrayBuffersMiB.toFixed(1)} MiB (included in external)`);
  console.log(`    rss:          ${m.rssMiB.toFixed(1)} MiB`);
}

async function loadParser() {
  if (!existsSync(builtParser)) {
    console.error(
      [
        '',
        'measure:db — the built engine was not found.',
        '',
        `  expected at: ${builtParser}`,
        '',
        '  Build the engine first:',
        '',
        '      npm run build',
        '      npm run measure:db',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
  const mod = await import(builtParser);
  return mod.parseAlmor;
}

async function measureAsset(dir, flags, { json, printJson }) {
  const manifestPath = dir.endsWith('.json') ? resolve(dir) : join(resolve(dir), 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`\nmeasure:db --asset — no Manifest at ${manifestPath}. Compile the Asset first: npm run compile:db\n`);
    process.exit(1);
  }
  if (!existsSync(builtNodeEntry)) {
    console.error(`\nmeasure:db --asset — the built Node entry was not found at ${builtNodeEntry}. Run \`npm run build\` first.\n`);
    process.exit(1);
  }
  const { loadDatabase } = await import(builtNodeEntry);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const storedBytes = manifest.shards.reduce((sum, shard) => sum + readFileSync(join(dirname(manifestPath), shard.path)).length, 0);

  console.log(`Loading the Asset at ${dir} with flags ${flags} ...`);
  collectAndMeasure();
  const start = performance.now();
  const db = await loadDatabase(dir, { flags });
  const loadMs = performance.now() - start;
  const memory = collectAndMeasure();

  console.log('\nAsserting the expected table counts (through counts()):\n');
  const failures = [];
  const counts = db.counts();
  for (const [key, expected] of Object.entries({ ...EXPECTED, ...EXPECTED_LAYOUTS })) {
    assertEqual(key, counts[key], expected, failures);
  }
  if (flags === 'r') {
    for (const [key, expected] of Object.entries(EXPECTED_GENERATION)) {
      assertEqual(key, counts[key], expected, failures);
    }
  }
  const measurements = {
    date: new Date().toISOString().slice(0, 10),
    node: process.version,
    v8: process.versions.v8,
    loadMs,
    memory,
    storedBytes,
    assetDigest: db.provenance.assetDigest,
  };

  console.log('\nRuntime measurements, loaded from the Asset:\n');
  console.log(`  Flags:                   ${flags}`);
  console.log(`  Node version:            ${measurements.node} (V8 ${measurements.v8})`);
  console.log(`  Date:                    ${measurements.date}`);
  console.log(`  Asset_Digest:            ${measurements.assetDigest}`);
  console.log(`  Stored_Bytes:            ${storedBytes.toLocaleString('en-US')} bytes`);
  console.log(`  Load time:               ${loadMs.toFixed(1)} ms`);
  printMemory('After the load, after gc() twice (recorded)', memory);

  if (json) {
    printJson(JSON.stringify({ flags, asset: true, ...measurements, failures }));
  }
  if (failures.length > 0) {
    console.error(`\nmeasure:db --asset — ${failures.length} count(s) did not match the expected table counts:`);
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }
  console.log('\nmeasure:db --asset — all expected table counts matched.');
}

async function main() {
  const json = process.argv.includes('--json');
  const printJson = console.log;
  if (json) {
    console.log = () => {};
  }
  const flagsIndex = process.argv.indexOf('--flags');
  const flags = flagsIndex === -1 ? 'a' : process.argv[flagsIndex + 1];
  if (flags !== 'a' && flags !== 'r') {
    console.error(`measure:db — --flags must be 'a' or 'r', got ${String(flags)}`);
    process.exit(2);
  }

  const assetIndex = process.argv.indexOf('--asset');
  if (assetIndex !== -1) {
    const dir = process.argv[assetIndex + 1];
    if (dir === undefined || dir.startsWith('--')) {
      console.error('measure:db — --asset needs the Asset directory (or its manifest.json).');
      process.exit(2);
    }
    if (typeof globalThis.gc !== 'function') {
      console.error('\nmeasure:db — gc() is not exposed. Run it as `npm run measure:db`.\n');
      process.exit(1);
    }
    await measureAsset(dir, flags, { json, printJson });
    return;
  }

  if (!existsSync(dbPath)) {
    skipWithNotice();
    return;
  }

  if (typeof globalThis.gc !== 'function') {
    console.error(
      '\nmeasure:db — gc() is not exposed. Run it as `npm run measure:db`, ' +
        'or with `node --expose-gc scripts/measure-db.mjs`.\n',
    );
    process.exit(1);
  }

  const parseAlmor = await loadParser();

  console.log(`Reading the Database_Pin from ${dbPath} ...`);
  const beforeRead = collectAndMeasure();
  let text = readFileSync(dbPath, 'utf8');
  const afterRead = collectAndMeasure();
  const sourceMiB = afterRead.retainedMiB - beforeRead.retainedMiB;
  const dbBytes = Buffer.byteLength(text, 'utf8');

  // Measure parse time around parseAlmor only (the read above is excluded).
  const start = performance.now();
  const db = parseAlmor(text, { flags });
  const parseMs = performance.now() - start;
  const throughputMiBps = dbBytes / (1024 * 1024) / (parseMs / 1000);

  // The memory method: collect with the source referenced, then drop the
  // script's only reference to it and collect again. What remains of the
  // source after the drop is what the model pins.
  const withSource = collectAndMeasure();
  text = null;
  const memory = collectAndMeasure();
  const freedMiB = withSource.retainedMiB - memory.retainedMiB;
  const retention = { sourceMiB, freedMiB, held: freedMiB >= 0.9 * sourceMiB };

  // The counts come from `counts()`, which reads the tuple model's arrays and
  // materializes nothing: no View is read, so the memory measured above is
  // the model's own.
  console.log('\nAsserting the expected table counts (through counts()):\n');
  const failures = [];
  const counts = db.counts();
  for (const [key, expected] of Object.entries({ ...EXPECTED, ...EXPECTED_LAYOUTS })) {
    assertEqual(key, counts[key], expected, failures);
  }
  if (flags === 'r') {
    for (const [key, expected] of Object.entries(EXPECTED_GENERATION)) {
      assertEqual(key, counts[key], expected, failures);
    }
  }

  const measurements = {
    date: new Date().toISOString().slice(0, 10),
    node: process.version,
    v8: process.versions.v8,
    parseMs,
    memory,
    retention,
    dbBytes,
    throughputMiBps,
  };

  console.log('\nRuntime measurements:\n');
  console.log(`  Flags:                   ${flags}`);
  console.log(`  Node version:            ${measurements.node} (V8 ${measurements.v8})`);
  console.log(`  Date:                    ${measurements.date}`);
  console.log(`  Database size:           ${dbBytes.toLocaleString('en-US')} bytes`);
  console.log(`  Parse time:              ${parseMs.toFixed(1)} ms`);
  console.log(`  Parse throughput:        ${throughputMiBps.toFixed(1)} MiB/s`);
  printMemory('Source referenced, after gc() twice', withSource);
  printMemory('Source dropped, after gc() twice (recorded)', memory);
  console.log(
    `  Source released:         ${freedMiB.toFixed(1)} of ${sourceMiB.toFixed(1)} MiB ` +
      `(${((100 * freedMiB) / sourceMiB).toFixed(1)}%; at least 90% required)`,
  );

  if (json) {
    printJson(JSON.stringify({ flags, ...measurements, failures }));
  }

  if (!retention.held) {
    console.error(
      `\nmeasure:db — the model retains its source: dropping it freed ` +
        `${freedMiB.toFixed(1)} of ${sourceMiB.toFixed(1)} MiB, under the 90% ` +
        'bound.',
    );
    process.exit(1);
  }

  if (failures.length > 0) {
    console.error(
      `\nmeasure:db — ${failures.length} count(s) did not match the expected table counts:`,
    );
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    console.error(
      '\nA mismatch is a parse bug or a database/pin drift, not a fixture to ' +
        'edit. Compare against the expected table counts in scripts/measure-db.mjs.',
    );
    process.exit(1);
  }

  console.log('\nmeasure:db — all expected table counts matched.');
}

main().catch((error) => {
  console.error('\nmeasure:db — unexpected error:');
  console.error(error);
  process.exit(1);
});
