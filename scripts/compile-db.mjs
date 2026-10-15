// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Compile the Database_Pin into the data package's Asset. It reads the built
// compiler from dist/ (`npm run build` first), compiles
// data/camel-morph-msa/msa-v1.0.db with packages/shanisarf-db-msa/source.json
// into packages/shanisarf-db-msa/asset/ (git-ignored), or into `--out <dir>`,
// and prints the Asset_Digest and each Shard's size, SHA-256 and stored size.
//
// After writing, it fails (exit 1) if any file in the output directory has
// the Database_Pin's size or content SHA-256: the raw database never ships.
//
// `--verify` compares the result with the committed expected digest,
// packages/shanisarf-db-msa/asset-digest.json, lists every difference, and
// exits 1 on any. The expected digest changes only in a reviewed commit that
// says why (a Format_Version bump, a new database, a fixed compiler bug).
// This script writes no committed file.
//
// Without the Database_Pin, a plain run skips with a notice and exits 0, as
// measure:db does; under `--verify` it exits 2, so the expected-digest gate
// cannot pass by not running.
//
// This is a new-design developer script: project header only, no ported-code
// notice.
//
// Usage:
//   npm run build
//   npm run compile:db                        # into packages/shanisarf-db-msa/asset/
//   npm run compile:db -- --out <dir>         # elsewhere (the release runbook's worktree)
//   npm run compile:db -- --verify            # and compare with asset-digest.json
//   npm run compile:db -- --out <dir> --strip-logprobs  # set lex_logprob and pos_lex_logprob to -99
//                                             # (only with --out: the data package carries the database's values)

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = join(repoRoot, 'data', 'camel-morph-msa', 'msa-v1.0.db');
const pkgDir = join(repoRoot, 'packages', 'shanisarf-db-msa');
const recordPath = join(pkgDir, 'source.json');
const digestPath = join(pkgDir, 'asset-digest.json');
const builtCompiler = join(repoRoot, 'dist', 'esm', 'compile', 'index.js');

const args = process.argv.slice(2);
const verify = args.includes('--verify');
const stripLogprobs = args.includes('--strip-logprobs');
const outAt = args.indexOf('--out');
if (outAt !== -1 && (args[outAt + 1] === undefined || args[outAt + 1].startsWith('--'))) {
  console.error('\ncompile:db — --out needs a directory.\n');
  process.exit(2);
}
const unknown = args.filter(
  (a, i) => a !== '--verify' && a !== '--strip-logprobs' && a !== '--out' && !(outAt !== -1 && i === outAt + 1),
);
if (unknown.length > 0) {
  console.error(`\ncompile:db — unknown arguments: ${unknown.join(' ')}\n`);
  process.exit(2);
}
if (stripLogprobs && outAt === -1) {
  console.error('\ncompile:db — --strip-logprobs needs --out: the data package is always built with the database\'s values.\n');
  process.exit(2);
}
const outDir = outAt === -1 ? join(pkgDir, 'asset') : resolve(args[outAt + 1]);

if (!existsSync(dbPath)) {
  console.error(
    [
      '',
      `compile:db — ${verify ? 'NOT VERIFIED' : 'SKIPPED'}: the Database_Pin is not present.`,
      '',
      `  expected at: ${dbPath}`,
      '',
      '  The Camel Morph MSA v1.0 database is CC BY 4.0 and is never committed',
      '  or packaged (see NOTICE and the hard invariants in CONTRIBUTING.md).',
      '  Fetch it, then compile:',
      '',
      '      npm run parity:setup      # fetches the DB into data/ (developer)',
      '      npm run compile:db        # compile it into the data package',
      '',
      verify
        ? '  --verify cannot pass without the database: exiting 2.'
        : '  This is not a failure; the build is unaffected.',
      '',
    ].join('\n'),
  );
  process.exit(verify ? 2 : 0);
}
if (!existsSync(builtCompiler)) {
  console.error(`\ncompile:db — the built compiler was not found at ${builtCompiler}. Run \`npm run build\` first.\n`);
  process.exit(1);
}

const { compileDatabaseFile } = await import(pathToFileURL(builtCompiler).href);
const started = performance.now();
const asset = await compileDatabaseFile(dbPath, recordPath, outDir, { stripLogprobs });
const seconds = (performance.now() - started) / 1000;
const manifest = JSON.parse(Buffer.from(asset.manifest).toString('utf8'));

const fmt = (n) => n.toLocaleString('en-US');
const storedTotal = Object.values(asset.shards).reduce((sum, b) => sum + b.length, 0);
console.log(`compile:db — compiled in ${seconds.toFixed(1)} s into ${outDir}`);
console.log(`  Format_Version ${manifest.formatVersion}`);
console.log(`  Asset_Digest   ${asset.assetDigest}`);
for (const shard of manifest.shards) {
  console.log(
    `  ${shard.part.padEnd(6)} ${shard.path.padEnd(10)} size ${fmt(shard.size).padStart(11)}  ` +
      `stored ${fmt(asset.shards[shard.path].length).padStart(10)}  sha256 ${shard.sha256}`,
  );
}
console.log(`  manifest.json  ${fmt(asset.manifest.length)} bytes; Stored_Bytes total ${fmt(storedTotal)}`);

// The raw database never ships: no output file has its size or content hash.
const record = JSON.parse(readFileSync(recordPath, 'utf8'));
const leaks = readdirSync(outDir)
  .map((name) => join(outDir, name))
  .filter((path) => statSync(path).isFile())
  .filter((path) => {
    const bytes = readFileSync(path);
    return bytes.length === record.sourceBytes || createHash('sha256').update(bytes).digest('hex') === record.sourceSha256;
  });
if (leaks.length > 0) {
  console.error(`\ncompile:db — FAIL: these files have the Database_Pin's size or SHA-256:\n${leaks.map((p) => `  ${p}`).join('\n')}\n`);
  process.exit(1);
}

if (verify) {
  if (!existsSync(digestPath)) {
    console.error(`\ncompile:db --verify — FAIL: no expected digest at ${digestPath}.\n`);
    process.exit(1);
  }
  const expected = JSON.parse(readFileSync(digestPath, 'utf8'));
  const actual = {
    formatVersion: manifest.formatVersion,
    assetDigest: asset.assetDigest,
    shards: manifest.shards.map(({ part, size, sha256 }) => ({ part, size, sha256 })),
  };
  const differences = [];
  if (expected.formatVersion !== actual.formatVersion) {
    differences.push(`formatVersion: expected ${expected.formatVersion}, got ${actual.formatVersion}`);
  }
  if (expected.assetDigest !== actual.assetDigest) {
    differences.push(`assetDigest: expected ${expected.assetDigest}, got ${actual.assetDigest}`);
  }
  const parts = new Set([...(expected.shards ?? []).map((s) => s.part), ...actual.shards.map((s) => s.part)]);
  for (const part of parts) {
    const e = (expected.shards ?? []).find((s) => s.part === part);
    const a = actual.shards.find((s) => s.part === part);
    for (const key of ['size', 'sha256']) {
      if (e?.[key] !== a?.[key]) {
        differences.push(`shards.${part}.${key}: expected ${e?.[key] ?? '(none)'}, got ${a?.[key] ?? '(none)'}`);
      }
    }
  }
  if (differences.length > 0) {
    console.error(`\ncompile:db --verify — FAIL: the Asset differs from ${digestPath}:\n${differences.map((d) => `  ${d}`).join('\n')}\n`);
    process.exit(1);
  }
  console.log(`compile:db --verify — the Asset matches ${digestPath}.`);
}
