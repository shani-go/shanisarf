// Thin launcher for the parity harness (tools/parity/). The harness is the
// only Python in the repo: a pinned CAMeL Tools venv that fetches the Camel
// Morph database and writes golden fixtures.
//
// Usage:
//   npm run parity:setup      # create the venv, install pins, smoke-test;
//                             #   then fetch the database if fetch_db.py exists
//   npm run parity:generate   # run CAMeL Tools and write fixtures/
//
// The venv lives at tools/parity/.venv/ (git-ignored) and the database at
// data/ (git-ignored). Nothing the venv installs is committed or packaged;
// shanisarf's engine has zero runtime dependencies.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const parityDir = join(repoRoot, 'tools', 'parity');
const venvDir = join(parityDir, '.venv');
const requirements = join(parityDir, 'requirements.txt');
const smokeImport = join(parityDir, 'smoke_import.py');
const fetchDb = join(parityDir, 'fetch_db.py');
const generatePy = join(parityDir, 'generate.py');

// Platform-correct interpreter inside the venv.
const venvPython =
  process.platform === 'win32'
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python');

function run(cmd, args, opts = {}) {
  const printable = [cmd, ...args].join(' ');
  console.error(`$ ${printable}`);
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: repoRoot,
    ...opts,
  });
  if (result.error) {
    console.error(`failed to run: ${printable}\n${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`command exited with status ${result.status}: ${printable}`);
    process.exit(result.status ?? 1);
  }
}

// Find a base Python 3.11–3.14 interpreter to create the venv with.
function findBasePython() {
  const candidates =
    process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python'];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) {
      return candidate;
    }
  }
  console.error(
    'no Python interpreter found. Install Python 3.11–3.14 (64-bit) and retry.',
  );
  process.exit(1);
  return undefined;
}

function setup() {
  if (!existsSync(requirements)) {
    console.error(`missing ${requirements}`);
    process.exit(1);
  }

  // 1. Create the venv if it is not there yet.
  if (!existsSync(venvPython)) {
    const basePython = findBasePython();
    run(basePython, ['-m', 'venv', venvDir]);
  }

  // 2. Upgrade pip tooling for reliable wheel resolution.
  run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);

  // 3. Install CAMeL Tools WITHOUT its dependency closure (no torch,
  //    transformers, scikit-learn, camel-kenlm, numpy, pandas, scipy, ...),
  //    then install the pinned analysis-path dependencies on their own.
  //    pip has no per-line --no-deps inside a requirements file, so the two
  //    phases are explicit here.
  run(venvPython, ['-m', 'pip', 'install', '--no-deps', 'camel-tools==1.6.0']);
  run(venvPython, ['-m', 'pip', 'install', '-r', requirements]);

  // 4. Prove the analysis path imports without the heavy, out-of-range deps
  //    and that no data-fetch entry point is reachable through the harness.
  if (existsSync(smokeImport)) {
    run(venvPython, [smokeImport]);
  }

  // 5. Fetch and verify the Database_Pin when its fetcher exists.
  if (existsSync(fetchDb)) {
    run(venvPython, [fetchDb]);
  } else {
    console.error(
      'note: tools/parity/fetch_db.py is missing; the venv is ready but the ' +
        'database has not been fetched.',
    );
  }

  console.error('parity:setup complete.');
}

function generate() {
  if (!existsSync(venvPython)) {
    console.error(
      'the parity venv is not built. Run `npm run parity:setup` first ' +
        '(creates tools/parity/.venv and fetches the Database_Pin).',
    );
    process.exit(1);
  }
  if (!existsSync(generatePy)) {
    console.error(`missing ${generatePy}`);
    process.exit(1);
  }
  // Run the generator in the venv; it writes the fixtures under fixtures/ and
  // runs its own guards (version, database SHA-256, Word_List scan, budget).
  // Any extra argv (e.g. --check) is forwarded.
  const extra = process.argv.slice(3);
  run(venvPython, [generatePy, ...extra]);
}

const command = process.argv[2];
switch (command) {
  case 'setup':
    setup();
    break;
  case 'generate':
    generate();
    break;
  default:
    console.error('usage: node scripts/parity.mjs <setup|generate>');
    process.exit(2);
}
