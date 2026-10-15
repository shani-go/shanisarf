// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The Consumer_Check. `npm run check:consumer` runs it. An application may
// install this package from a tarball, a git URL or a path; this script
// proves each of the three:
//
//   1. `npm run build`; `npm pack` into a scratch directory under the OS
//      temporary directory.
//   2. For each install mode (the tarball; the repository at HEAD through a
//      `git+file://` URL; the repository path), a scratch ESM consumer
//      (`"type": "module"`) installs the package and runs one ESM and one
//      CommonJS script. Each imports `shanisarf` and `shanisarf/worker`,
//      parses an invented one-entry ALMOR text (the one check-build.mjs
//      uses), analyzes a word, builds a `Lexicon` and looks a lemma up,
//      calls `cliticSegments`, `placeMarks` and `agreedMarks`, creates a
//      worker analyzer over the same text, analyzes and looks up through
//      it, terminates it, and, when packages/shanisarf-db-msa/asset/
//      exists, `loadDatabase`s that Asset and analyzes a database word.
//   3. With `--vite`: a fourth scratch consumer installs the tarball, then
//      `vite` from the npm registry (the check's only network use, and only
//      under this flag; `vite` never enters this repository's
//      package.json). It scaffolds a page that imports `shanisarf` and
//      `shanisarf/worker` and calls `createWorkerAnalyzer({ source: {
//      asset: '/asset/' } })`, with the data package's Asset copied beside
//      it, runs `vite build`, and confirms that the output holds a separate
//      worker chunk and that no emitted chunk imports a `node:` module.
//      With `--serve` as well, it then runs the Vite dev server on that
//      page and waits (Ctrl-C ends it) for the manual check: the page
//      analyzes a database word from the Asset in a worker and shows it.
//
// What a reader should know about the modes:
//
//   - The git mode installs the committed tree at HEAD, not the working
//     tree; the check says so when the tree is dirty. The tarball and path
//     modes cover the working tree.
//   - A path install links the directory and runs no lifecycle script, so
//     it needs `npm run build` in the repository first; step 1 runs it.
//   - `"prepare": "npm run build"` is what makes the git install work (npm
//     clones, installs devDependencies, runs `prepare`, then packs). npm
//     also runs `prepare` on every bare `npm install` or `npm ci` in this
//     repository and before `npm pack`, so this check's `npm pack` builds a
//     second time after step 1 (Hazard 14).
//   - Installs run with `--offline`: npm's cache only, no network. A git
//     install also installs the repository's devDependencies into npm's
//     clone, so they must be in the cache (any earlier `npm install` here
//     put them there); when they are not, the git step fails and says so.
//
// REPORT-ONLY: it writes only under one scratch directory in the OS
// temporary directory, which it removes on every exit, and edits nothing in
// the repository (its build writes dist/, as `npm run build` does). Every
// mode and every step runs even after a failure; it exits 1 naming each
// failed mode and step, 0 when all pass.
//
//   node scripts/check-consumer.mjs [--vite [--serve] [--port N] [--vite-spec SPEC]]
//
// This is a new-design developer script: project header only.

import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const VITE = flag('--vite') || flag('--serve');
const SERVE = flag('--serve');
const PORT = Number(option('--port', '5173'));
const VITE_SPEC = option('--vite-spec', 'vite');

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const assetDir = join(root, 'packages/shanisarf-db-msa/asset');
const digestFile = join(root, 'packages/shanisarf-db-msa/asset-digest.json');
const HAVE_ASSET = existsSync(join(assetDir, 'manifest.json'));
const ASSET_DIGEST = HAVE_ASSET && existsSync(digestFile) ? JSON.parse(readFileSync(digestFile, 'utf8')).assetDigest : undefined;

/** A word of the Camel Morph MSA database (a stem surface the demo page also uses). */
const DB_WORD = 'كتاب';

// The child processes see this environment without npm's own `npm_*`
// variables (set when the check runs under `npm run`), so each npm below
// reads its configuration as a fresh command would.
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.toLowerCase().startsWith('npm_')),
);
childEnv.npm_config_update_notifier = 'false';

const failures = [];
const report = (ok, mode, step, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} [${mode}] ${step}${detail === '' ? '' : ` (${detail})`}`);
  if (!ok) failures.push(`${mode}: ${step}${detail === '' ? '' : ` (${detail})`}`);
};
const note = (text) => console.log(`NOTE ${text}`);

/** The last lines of a command's output, for a failure report. */
const tail = (text, n = 15) =>
  String(text ?? '')
    .trimEnd()
    .split('\n')
    .slice(-n)
    .map((line) => `       | ${line}`)
    .join('\n');

/** Run a command to completion; its status and output. */
function run(command, argv, cwd, options = {}) {
  const r = spawnSync(command, argv, {
    cwd,
    env: childEnv,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 15 * 60 * 1000,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`;
  return { ok: r.status === 0, status: r.status, stdout: r.stdout ?? '', output };
}

/** Run a step: report it, print the output's tail on failure; whether it passed. */
function step(mode, label, command, argv, cwd, options = {}) {
  const r = run(command, argv, cwd, options);
  report(r.ok, mode, label, r.ok ? '' : `exit ${r.status}`);
  if (!r.ok) console.log(tail(r.output));
  return r;
}

// ---------------------------------------------------------------------------
// The consumer scripts. One body, two module systems.
// ---------------------------------------------------------------------------

/** The checks a consumer runs, given the two entries; prints one line per check and exits 1 on any failure. */
const CONSUMER_BODY = String.raw`
const TINY_DB = [
  '###DEFINES###',
  'DEFINE pos pos:noun',
  'DEFINE diac diac:*open*',
  'DEFINE lex lex:*open*',
  '###DEFAULTS###',
  'DEFAULT pos:noun',
  '###ORDER###',
  'ORDER pos',
  '###TOKENIZATIONS###',
  'TOKENIZATION diac',
  '###STEMBACKOFF###',
  '###PREFIXES###',
  '\tP0\tdiac:',
  '###SUFFIXES###',
  '\tX0\tdiac:',
  '###STEMS###',
  'زرق\tS0\tdiac:زَرَق lex:زَرَق_1 pos:noun',
  '###TABLE AB###',
  'P0 S0',
  '###TABLE BC###',
  'S0 X0',
  '###TABLE AC###',
  'P0 X0',
  '',
].join('\n');
const WORD = 'زرق';
const DIAC = 'زَرَق';
const LEMMA = 'زَرَق'; // the parser strips the lex's _1 under analysis

async function checks(sh, sw, assetDir, digest, dbWord) {
  const failed = [];
  const check = async (label, fn) => {
    try {
      const detail = await fn();
      console.log('ok   ' + label + (detail ? ' (' + detail + ')' : ''));
    } catch (e) {
      failed.push(label);
      console.log('FAIL ' + label + ': ' + (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e)));
    }
  };
  const expect = (ok, what) => {
    if (!ok) throw new Error(what);
  };

  await check('imports', () => {
    for (const name of ['parseAlmor', 'Analyzer', 'Lexicon', 'cliticSegments', 'placeMarks', 'agreedMarks', 'loadDatabase']) {
      expect(typeof sh[name] === 'function', 'shanisarf exports no function ' + name);
    }
    expect(Array.isArray(sh.MSA_FEATURE_NAMES), 'shanisarf exports no MSA_FEATURE_NAMES');
    expect(typeof sw.createWorkerAnalyzer === 'function', 'shanisarf/worker exports no createWorkerAnalyzer');
  });
  let db = null;
  let analyses = [];
  await check('parse', () => {
    db = sh.parseAlmor(TINY_DB);
  });
  await check('analyze', () => {
    analyses = new sh.Analyzer(db).analyze(WORD);
    expect(analyses.length > 0 && analyses[0].diac === DIAC, 'expected an analysis with diac ' + DIAC);
    return analyses.length + ' analyses';
  });
  await check('lexicon lookup', () => {
    const found = new sh.Lexicon(db).byLemma(LEMMA);
    expect(found.length === 1 && found[0].surface === WORD, 'expected one entry of surface ' + WORD);
    return found.length + ' entry';
  });
  await check('alignment', () => {
    const segments = sh.cliticSegments(WORD, analyses[0], { scheme: 'diac' });
    expect(segments !== null && segments.length === 1 && segments[0].role === 'stem' && segments[0].text === WORD, 'cliticSegments: ' + JSON.stringify(segments));
    const placed = sh.placeMarks(WORD, DIAC);
    expect(placed === DIAC, 'placeMarks: ' + JSON.stringify(placed));
    const agreed = sh.agreedMarks(WORD, [DIAC, DIAC]);
    expect(agreed === DIAC, 'agreedMarks: ' + JSON.stringify(agreed));
  });
  await check('worker analyze, lookup, terminate', async () => {
    const worker = await sw.createWorkerAnalyzer({ source: TINY_DB });
    try {
      const got = await worker.analyze(WORD);
      expect(got.length === analyses.length && got[0].diac === DIAC, 'the worker analyzes otherwise');
      const found = await worker.lookup('lemma', LEMMA, { features: ['diac'] });
      expect(found.length === 1 && found[0].surface === WORD && found[0].features.diac === DIAC, 'worker lookup: ' + JSON.stringify(found));
    } finally {
      await worker.terminate();
    }
    return 'in a worker';
  });
  if (assetDir) {
    await check('loadDatabase the Asset and analyze a database word', async () => {
      const asset = await sh.loadDatabase(assetDir, digest ? { manifestSha256: digest } : {});
      const n = new sh.Analyzer(asset).analyze(dbWord).length;
      expect(n > 0, 'no analysis of ' + dbWord);
      expect(asset.provenance && asset.provenance.credits.length > 0, 'the Asset has no credits');
      return n + ' analyses';
    });
  } else {
    console.log('skip loadDatabase: packages/shanisarf-db-msa/asset/ does not exist');
  }
  process.exitCode = failed.length === 0 ? 0 : 1;
}
`;

const consumerArgs = (asset) => [asset ? assetDir : '', asset ? (ASSET_DIGEST ?? '') : '', DB_WORD];

const ESM_CONSUMER = `${CONSUMER_BODY}
import * as sh from 'shanisarf';
import * as sw from 'shanisarf/worker';
const [assetDir, digest, dbWord] = process.argv.slice(2);
await checks(sh, sw, assetDir, digest, dbWord);
`;

const CJS_CONSUMER = `'use strict';
${CONSUMER_BODY}
const sh = require('shanisarf');
const sw = require('shanisarf/worker');
const [assetDir, digest, dbWord] = process.argv.slice(2);
checks(sh, sw, assetDir, digest, dbWord).catch((e) => {
  console.log('FAIL ' + e.message);
  process.exitCode = 1;
});
`;

/** A scratch consumer: a directory with an ESM package.json and the two scripts. */
function makeConsumer(scratch, name) {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: `consumer-${name}`, version: '0.0.0', private: true, type: 'module' }, null, 2)}\n`,
  );
  writeFileSync(join(dir, 'consumer.mjs'), ESM_CONSUMER);
  writeFileSync(join(dir, 'consumer.cjs'), CJS_CONSUMER);
  return dir;
}

const INSTALL_FLAGS = ['--offline', '--no-audit', '--no-fund', '--loglevel=error'];

/** Install `spec` into a fresh consumer and run both scripts; each a reported step. */
function checkMode(scratch, mode, spec, hint = '') {
  const dir = makeConsumer(scratch, mode);
  const install = step(mode, 'install', NPM, ['install', ...INSTALL_FLAGS, spec], dir);
  if (!install.ok && hint !== '') note(hint);
  if (install.ok) {
    const built = existsSync(join(dir, 'node_modules/shanisarf/dist/esm/index.js'));
    report(built, mode, 'the installed package holds dist/', built ? '' : 'nothing built it: is `prepare` in the installed package.json?');
  }
  for (const [label, file] of [
    ['ESM script', 'consumer.mjs'],
    ['CommonJS script', 'consumer.cjs'],
  ]) {
    const r = run(process.execPath, [file, ...consumerArgs(HAVE_ASSET)], dir, { timeout: 5 * 60 * 1000 });
    const failedChecks = r.output
      .split('\n')
      .filter((line) => line.startsWith('FAIL '))
      .map((line) => line.slice(5).split(':')[0]);
    report(r.ok, mode, label, r.ok ? lastOk(r.output) : failedChecks.length > 0 ? failedChecks.join('; ') : `exit ${r.status}`);
    if (!r.ok) console.log(tail(r.output));
  }
}

/** A short summary of a passing consumer run: how many checks it passed. */
function lastOk(output) {
  const lines = output.split('\n');
  const oks = lines.filter((l) => l.startsWith('ok   ')).length;
  const asset = lines.find((l) => l.startsWith('ok   loadDatabase'));
  return `${oks} checks${asset ? `, the Asset: ${asset.slice(asset.lastIndexOf('(') + 1, -1)} of ${DB_WORD}` : ''}`;
}

// ---------------------------------------------------------------------------
// The Vite mode.
// ---------------------------------------------------------------------------

const VITE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>shanisarf consumer check</title>
  </head>
  <body>
    <pre id="result" data-state="loading">loading</pre>
    <script type="module" src="/main.js"></script>
  </body>
</html>
`;

const viteMain = (digest) => `import { Analyzer, cliticSegments } from 'shanisarf';
import { createWorkerAnalyzer } from 'shanisarf/worker';

const WORD = ${JSON.stringify(DB_WORD)};
const out = document.getElementById('result');

async function main() {
  const t0 = performance.now();
  const analyzer = await createWorkerAnalyzer({ source: { asset: '/asset/'${digest ? `, manifestSha256: ${JSON.stringify(digest)}` : ''} } });
  try {
    const analyses = await analyzer.analyze(WORD);
    const found = await analyzer.lookup('stem', WORD, { features: ['lex'] });
    const ms = Math.round(performance.now() - t0);
    out.dataset.state = analyses.length > 0 ? 'ok' : 'empty';
    out.textContent = [
      'state: ' + out.dataset.state,
      'word: ' + WORD,
      'analyses: ' + analyses.length + ' (in a worker, from the Asset)',
      'first: ' + analyses[0]?.diac + ' ' + analyses[0]?.lex + ' ' + analyses[0]?.pos,
      'lookup stem: ' + found.length + ' entries',
      'database: ' + analyzer.provenance?.name + ' ' + analyzer.provenance?.version + ', ' + analyzer.provenance?.license.id,
      'ready and analyzed in ' + ms + ' ms',
      'core entry loaded: ' + (typeof Analyzer === 'function' && typeof cliticSegments === 'function'),
    ].join('\\n');
  } finally {
    await analyzer.terminate();
  }
}

main().catch((e) => {
  out.dataset.state = 'error';
  out.textContent = 'state: error\\n' + (e?.name ?? 'Error') + ': ' + (e?.message ?? String(e));
});
`;

// The page runs on Vite's defaults: no vite.config.js. The package's own
// `new URL('./entry-web.js', import.meta.url)` worker is what Vite turns into
// a worker chunk in the build and serves as a module worker in the dev
// server, with no setting (checked with Vite 8.3.4).

/** The `node:` specifiers a built chunk imports. */
const NODE_IMPORT = /(?:from\s*|import\s*\(\s*|import\s*)["'](node:[^"']+)["']/gu;

function checkVite(scratch, tarball) {
  const mode = 'vite';
  if (tarball === null) {
    report(false, mode, 'scaffold', 'no tarball to install');
    return null;
  }
  if (!HAVE_ASSET) {
    report(false, mode, 'scaffold', 'packages/shanisarf-db-msa/asset/ does not exist; run npm run compile:db');
    return null;
  }
  const dir = makeConsumer(scratch, mode);
  step(mode, 'install the tarball', NPM, ['install', ...INSTALL_FLAGS, tarball], dir);
  const viteInstall = step(mode, `install ${VITE_SPEC} from the registry`, NPM, ['install', '--no-audit', '--no-fund', '--loglevel=error', '--save-dev', VITE_SPEC], dir);
  let viteVersion = 'unknown';
  try {
    viteVersion = JSON.parse(readFileSync(join(dir, 'node_modules/vite/package.json'), 'utf8')).version;
  } catch {
    // reported by the install step
  }
  if (viteInstall.ok) note(`vite ${viteVersion} installed into the scratch consumer only`);

  writeFileSync(join(dir, 'index.html'), VITE_HTML);
  writeFileSync(join(dir, 'main.js'), viteMain(ASSET_DIGEST));
  cpSync(assetDir, join(dir, 'public/asset'), { recursive: true, dereference: true });

  const viteBin = join(dir, 'node_modules/vite/bin/vite.js');
  const build = step(mode, 'vite build', process.execPath, [viteBin, 'build', '--logLevel', 'warn'], dir);
  if (build.ok) {
    const distDir = join(dir, 'dist');
    const html = readFileSync(join(distDir, 'index.html'), 'utf8');
    const mainSrc = /<script[^>]*type="module"[^>]*src="\/?([^"]+)"/u.exec(html)?.[1];
    const jsFiles = (d) =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? (e.name === 'asset' ? [] : jsFiles(join(d, e.name))) : e.name.endsWith('.js') ? [join(d, e.name)] : [],
      );
    const chunks = jsFiles(distDir).map((f) => relative(distDir, f));
    const mainText = mainSrc && existsSync(join(distDir, mainSrc)) ? readFileSync(join(distDir, mainSrc), 'utf8') : '';
    const workers = chunks.filter((c) => c !== mainSrc && mainText.includes(c.split('/').pop()) && /new Worker\(/u.test(mainText));
    report(mainText !== '' && workers.length > 0, mode, 'a separate worker chunk', `main ${mainSrc ?? 'not found'}; worker ${workers.join(', ') || 'none'}; ${chunks.length} chunks`);
    const nodeImports = chunks.flatMap((c) =>
      [...readFileSync(join(distDir, c), 'utf8').matchAll(NODE_IMPORT)].map((m) => `${c}: ${m[1]}`),
    );
    // Vite replaces a `node:` import in browser code with an empty stub and
    // says so on the console ("externalized for browser compatibility"), so
    // the build's own output is read as well as the chunks.
    const externalized = build.output.split('\n').filter((line) => /externalized for browser compatibility|["']node:/u.test(line));
    const found = [...nodeImports, ...externalized.map((line) => `vite: ${line.trim()}`)];
    report(mainText !== '' && found.length === 0, mode, 'no node: import in the main chunk (nor any chunk, nor externalized by vite)', found.join('; '));
  }
  return { dir, viteBin, viteVersion };
}

/** Whether the dev server is running; until then a signal ends the check as in the default mode. */
let serving = false;

/** Run the Vite dev server over the scaffold until a signal; the manual check. */
function serve(vite) {
  serving = true;
  return new Promise((resolveServe) => {
    console.log(`\nThe dev server for the manual check: http://localhost:${PORT}/ (Ctrl-C ends it and removes the scratch directory)`);
    const child = spawn(process.execPath, [vite.viteBin, '--port', String(PORT), '--strictPort'], {
      cwd: vite.dir,
      env: childEnv,
      stdio: 'inherit',
    });
    let stopping = false;
    const stop = () => {
      stopping = true;
      child.kill('SIGTERM');
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    child.on('exit', (code, signal) => {
      if (!stopping && code !== 0 && signal === null) report(false, 'vite', 'dev server', `exit ${code}`);
      resolveServe();
    });
  });
}

// ---------------------------------------------------------------------------
// Driver.
// ---------------------------------------------------------------------------

const scratch = mkdtempSync(join(tmpdir(), 'shanisarf-consumer-'));
const cleanup = () => rmSync(scratch, { recursive: true, force: true });
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (serving) return; // the dev server's handler ends it; the driver then exits
    cleanup();
    process.exit(1);
  });
}

async function main() {
  console.log('shanisarf consumer check (report-only; edits nothing in the repository)\n');
  console.log(`scratch directory: ${scratch}`);
  note('a path install links the repository and runs no lifecycle script, so it needs `npm run build` there first; this check runs it.');
  note('`prepare` (npm run build) runs on every bare `npm install` or `npm ci` in this repository and before `npm pack`, so `npm pack` below builds a second time.');

  const head = run('git', ['rev-parse', 'HEAD'], root);
  const dirty = run('git', ['status', '--porcelain'], root);
  if (head.ok && dirty.ok && dirty.stdout.trim() !== '') {
    note(`the working tree is dirty (${dirty.stdout.trim().split('\n').length} paths): the git mode installs the committed tree at HEAD ${head.stdout.trim().slice(0, 12)}, not these changes; the tarball and path modes cover them.`);
  }
  if (!HAVE_ASSET) note('packages/shanisarf-db-msa/asset/ does not exist (npm run compile:db builds it): the scripts skip loadDatabase.');
  console.log('');

  step('repository', 'npm run build', NPM, ['run', 'build'], root);

  const packDir = join(scratch, 'pack');
  mkdirSync(packDir);
  const pack = step('tarball', 'npm pack', NPM, ['pack', '--json', '--loglevel=error', '--pack-destination', packDir], root);
  let tarball = null;
  if (pack.ok) {
    try {
      const json = pack.stdout.slice(pack.stdout.indexOf('['));
      tarball = join(packDir, JSON.parse(json)[0].filename);
      if (!existsSync(tarball)) tarball = null;
    } catch {
      tarball = null;
    }
    if (tarball === null) report(false, 'tarball', 'npm pack', 'no tarball named in its output');
  }

  if (tarball !== null) checkMode(scratch, 'tarball', tarball);
  else report(false, 'tarball', 'install', 'skipped: no tarball');

  if (head.ok) {
    checkMode(
      scratch,
      'git',
      `git+${pathToFileURL(root).href}#${head.stdout.trim()}`,
      "a git install runs npm's own install of the repository's devDependencies in its clone, offline here: if the failure names a missing cache entry, those devDependencies are not in npm's cache.",
    );
  } else {
    report(false, 'git', 'git rev-parse HEAD', 'not a git repository');
  }

  checkMode(scratch, 'path', root);

  if (VITE) {
    const vite = checkVite(scratch, tarball);
    if (vite !== null && SERVE) await serve(vite);
  }

  console.log(
    failures.length === 0
      ? '\ncheck:consumer — every mode and step passed.'
      : `\ncheck:consumer — ${failures.length} step(s) failed:\n${failures.map((f) => `  - ${f}`).join('\n')}`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

try {
  await main();
} catch (e) {
  console.log(`FAIL [check] ${e?.stack ?? e}`);
  process.exitCode = 1;
}
