// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Asset-mode parity: compile the Database_Pin into a temporary directory with
// `compile:db --out`, then run the parity replays (`vitest run tests/parity`)
// with SHANISARF_PARITY_ASSET naming it, so every fixture under
// fixtures/parity/ is replayed over a model loaded from the Asset through the
// Node entry's `loadDatabase` instead of over the parsed text. Every fixture
// must pass unchanged, as in text mode. The temporary directory is removed
// afterwards.
//
// Without the Database_Pin it skips with the parity notice and exits 0, as
// the replays do. It needs `npm run build` first (compile:db reads dist/).
// The first-publish runbook's D3 sets SHANISARF_PARITY_ASSET to the packed
// data package's Asset instead, and runs the replays the same way.
//
// This is a new-design developer script: project header only, no ported-code
// notice.
//
// Usage:
//   npm run build
//   npm run parity:asset

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = join(repoRoot, 'data', 'camel-morph-msa', 'msa-v1.0.db');

if (!existsSync(dbPath)) {
  console.error(
    [
      '',
      'parity:asset — SKIPPED: the Database_Pin is not present.',
      '',
      `  expected at: ${dbPath}`,
      '',
      '      npm run parity:setup      # fetches the DB into data/ (developer)',
      '      npm run parity:asset      # compile it and replay every fixture over the Asset',
      '',
      '  This is not a failure; the build is unaffected.',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const out = mkdtempSync(join(tmpdir(), 'shanisarf-parity-asset-'));
let status = 1;
try {
  // The replay's Asset is the data package's Asset as built (the compiler is
  // reproducible, so the digest is the same), compiled into a temporary
  // directory that is removed below so the package directory is untouched.
  const compiled = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'compile-db.mjs'), '--out', out], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (compiled.status !== 0) {
    console.error(`\nparity:asset — compile:db failed (exit ${compiled.status}).\n`);
    process.exit(compiled.status ?? 1);
  }
  const vitest = join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const replay = spawnSync(process.execPath, [vitest, 'run', 'tests/parity'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, SHANISARF_PARITY_ASSET: out },
  });
  status = replay.status ?? 1;
  console.log(
    status === 0
      ? `\nparity:asset — every fixture passed over the Asset compiled into ${out}.`
      : `\nparity:asset — the replay over the Asset failed (exit ${status}).`,
  );
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exit(status);
