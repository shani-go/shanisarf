// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The build check. `npm run build` runs it last; `npm run check:build` runs
// it alone over an existing dist/. It confirms:
//
//   1. `shanisarf/worker` resolves by self-reference under Node's `import`
//      and `require` conditions, to the ESM and CJS Node entries, and each
//      loads and exports `createWorkerAnalyzer`;
//   2. each Node entry starts its worker from the script next to it and
//      analyzes a word (an invented one-entry database);
//   3. the `default` target and the `types` file exist, and the default
//      target loads in Node without starting a worker;
//   4. the core entry's import graph (dist/esm/index.js) reaches nothing
//      under worker/;
//   5. each build holds only its own locator files (the ESM-only and
//      CJS-only files are excluded from the other build) and the CJS build
//      has no `import.meta` (TS1343);
//   6. package.json has no runtime dependencies.
//
// For the package root's entries, the compiler and the loader:
//
//   7. `.` resolves under `node` (`import`, `require`) to the Node entries,
//      by self-reference, and, by the exports map's conditions, under
//      `import` and `require` without `node` to the browser entries;
//      `./compile` resolves under `node` only, and the types exist;
//   8. the browser graphs (dist/esm/index.js, dist/esm/worker/web.js and
//      dist/esm/worker/entry-web.js) reach no `node:` module and no bare
//      specifier;
//   9. both Node entries' `loadDatabase` open a tiny Asset compiled (through
//      `shanisarf/compile`) into a temporary directory, from a path, which
//      analyzes a word and carries its Provenance.
//
// For the source-map policy:
//
//  10. dist/ holds no source map and no built `.js` names one. The ESM and
//      CJS builds set `"sourceMap": false`: a map's `sources` point into
//      src/, which the tarball does not ship, so a consumer's tooling (Vite's
//      dev server) warns once per module. `npm run build` does not clean
//      dist/, so maps left by an earlier build fail this until `npm run
//      clean`.
//
// REPORT-ONLY: it reads dist/ and package.json, starts two short-lived
// workers, writes and removes one temporary directory, prints what it finds,
// and edits nothing in the repository. Exit 0 when every check passes, 1
// otherwise.
//
// This is a new-design developer script: project header only.

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const exportsWorker = pkg.exports?.['./worker'];
const failures = [];

function check(ok, label, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` (${detail})`}`);
  if (!ok) failures.push(label);
}

const rel = (path) => relative(root, path);

/** An invented database: one prefix, one suffix and one stem, all compatible. */
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

/** Start a worker through `mod` and analyze one word; the number of analyses. */
async function smoke(mod) {
  const analyzer = await mod.createWorkerAnalyzer({ source: TINY_DB });
  try {
    return (await analyzer.analyze('زرق')).length;
  } finally {
    await analyzer.terminate();
  }
}

if (exportsWorker === undefined) {
  check(false, 'package.json exports ./worker');
} else {
  // 1 and 2: the node conditions, by self-reference.
  const esmPath = resolve(root, exportsWorker.node.import);
  const cjsPath = resolve(root, exportsWorker.node.require);
  let resolvedImport = null;
  try {
    resolvedImport = fileURLToPath(import.meta.resolve('shanisarf/worker'));
  } catch (e) {
    resolvedImport = `unresolved: ${e.message}`;
  }
  check(resolvedImport === esmPath, 'shanisarf/worker resolves under import', rel(String(resolvedImport)));
  try {
    const mod = await import('shanisarf/worker');
    check(typeof mod.createWorkerAnalyzer === 'function', 'the import entry exports createWorkerAnalyzer');
    const n = await smoke(mod);
    check(n > 0, 'the import entry starts entry-node.js and analyzes', `${n} analyses`);
  } catch (e) {
    check(false, 'the import entry loads and runs', e.message);
  }

  const require = createRequire(import.meta.url);
  let resolvedRequire = null;
  try {
    resolvedRequire = require.resolve('shanisarf/worker');
  } catch (e) {
    resolvedRequire = `unresolved: ${e.message}`;
  }
  check(resolvedRequire === cjsPath, 'shanisarf/worker resolves under require', rel(String(resolvedRequire)));
  try {
    const mod = require('shanisarf/worker');
    check(typeof mod.createWorkerAnalyzer === 'function', 'the require entry exports createWorkerAnalyzer');
    const n = await smoke(mod);
    check(n > 0, 'the require entry starts entry-node.js and analyzes', `${n} analyses`);
  } catch (e) {
    check(false, 'the require entry loads and runs', e.message);
  }

  // 3: the default target and the types.
  const defaultPath = resolve(root, exportsWorker.default);
  check(existsSync(defaultPath), 'the default target exists', rel(defaultPath));
  try {
    const mod = await import(pathToFileURL(defaultPath).href);
    check(typeof mod.createWorkerAnalyzer === 'function', 'the default target loads without starting a worker');
  } catch (e) {
    check(false, 'the default target loads without starting a worker', e.message);
  }
  check(existsSync(resolve(root, exportsWorker.types)), 'the ./worker types exist', exportsWorker.types);
}

// 4: the core entry's import graph.
const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/gu;

/** The modules an ESM file's graph reaches, and the bare (non-relative) specifiers it imports. */
function graph(entry) {
  const seen = new Set();
  const bare = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith('.')) queue.push(resolve(dirname(file), spec));
      else bare.add(spec);
    }
  }
  return { seen, bare };
}

const core = graph(join(root, 'dist/esm/index.js'));
const reached = [...core.seen].filter((file) => file.split('/').includes('worker')).map(rel);
check(core.seen.size > 1 && reached.length === 0, 'dist/esm/index.js imports nothing under worker/', reached.length === 0 ? `${core.seen.size} modules` : reached.join(', '));

// 5: each build holds its own locators; no import.meta in CJS.
const has = (path) => existsSync(join(root, path));
check(has('dist/esm/worker/web.js') && has('dist/esm/worker/node-import.js') && has('dist/esm/worker/entry-web.js'), 'the ESM build has web.js, node-import.js and entry-web.js');
check(!has('dist/esm/worker/node-require.js'), 'the ESM build leaves node-require.js out');
check(has('dist/cjs/worker/node-require.js') && has('dist/cjs/worker/entry-node.js'), 'the CJS build has node-require.js and entry-node.js');
check(!has('dist/cjs/worker/web.js') && !has('dist/cjs/worker/node-import.js') && !has('dist/cjs/worker/entry-web.js'), 'the CJS build leaves the ESM-only files out');
const jsFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? jsFiles(path) : path.endsWith('.js') ? [path] : [];
  });
const withImportMeta = has('dist/cjs') ? jsFiles(join(root, 'dist/cjs')).filter((f) => readFileSync(f, 'utf8').includes('import.meta')) : [];
check(withImportMeta.length === 0, 'the CJS build has no import.meta (TS1343)', withImportMeta.map(rel).join(', '));

// 6: zero runtime dependencies.
check(Object.keys(pkg.dependencies ?? {}).length === 0, 'package.json has no runtime dependencies');

// 7: the conditions of `.` and `./compile`.
/** The target an exports entry gives under `conditions`, by Node's rule: the first key that is `default` or a condition. */
function target(entry, conditions) {
  if (typeof entry === 'string') return entry;
  if (entry === null || typeof entry !== 'object') return null;
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'default' || conditions.includes(key)) {
      const found = target(value, conditions);
      if (found !== null) return found;
    }
  }
  return null;
}
const dot = pkg.exports?.['.'];
const compile = pkg.exports?.['./compile'];
const expectTarget = (entry, conditions, want, label) => {
  const got = target(entry, conditions);
  check(got === want, label, String(got));
};
expectTarget(dot, ['node', 'import'], './dist/esm/index-node.js', '. resolves under node + import to the Node entry');
expectTarget(dot, ['node', 'require'], './dist/cjs/index-node.js', '. resolves under node + require to the Node entry');
expectTarget(dot, ['browser', 'import'], './dist/esm/index.js', '. resolves under import without node to the browser entry');
expectTarget(dot, ['browser', 'require'], './dist/cjs/index.js', '. resolves under require without node to the browser entry');
expectTarget(compile, ['node', 'import'], './dist/esm/compile/index.js', './compile resolves under node + import');
expectTarget(compile, ['node', 'require'], './dist/cjs/compile/index.js', './compile resolves under node + require');
expectTarget(compile, ['browser', 'import'], null, './compile does not resolve without node');
check(existsSync(resolve(root, dot?.types ?? '-')) && existsSync(resolve(root, compile?.types ?? '-')), 'the . and ./compile types exist');
const requireHere = createRequire(import.meta.url);
let selfImport;
let selfRequire;
try {
  selfImport = fileURLToPath(import.meta.resolve('shanisarf'));
} catch (e) {
  selfImport = `unresolved: ${e.message}`;
}
try {
  selfRequire = requireHere.resolve('shanisarf');
} catch (e) {
  selfRequire = `unresolved: ${e.message}`;
}
check(selfImport === resolve(root, 'dist/esm/index-node.js'), 'shanisarf resolves in Node under import to the Node entry', rel(String(selfImport)));
check(selfRequire === resolve(root, 'dist/cjs/index-node.js'), 'shanisarf resolves in Node under require to the Node entry', rel(String(selfRequire)));

// 8: no node: module, and no bare specifier, in the browser graphs.
for (const entry of ['dist/esm/index.js', 'dist/esm/worker/web.js', 'dist/esm/worker/entry-web.js']) {
  const { seen, bare } = graph(join(root, entry));
  check(seen.size > 0 && bare.size === 0, `${entry} reaches no node: module or bare specifier`, bare.size === 0 ? `${seen.size} modules` : [...bare].join(', '));
}

// 9: the Node entries load a tiny compiled Asset from a path.
const tmp = mkdtempSync(join(tmpdir(), 'shanisarf-check-build-'));
try {
  const compiler = await import('shanisarf/compile');
  const bytes = new Uint8Array(Buffer.from(TINY_DB, 'utf8'));
  const asset = await compiler.compileDatabase(bytes, {
    id: 'tiny',
    name: 'Tiny',
    version: '0.0',
    source: 'https://example.invalid/tiny.db',
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    sourceBytes: bytes.length,
    license: { id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    credits: 'An invented database.',
    disclaimer: 'No warranty.',
    citation: 'None.',
  });
  await compiler.writeAsset(tmp, asset);
  for (const [label, mod] of [
    ['import', await import('shanisarf')],
    ['require', requireHere('shanisarf')],
  ]) {
    try {
      const db = await mod.loadDatabase(tmp, { manifestSha256: asset.assetDigest });
      const n = new mod.Analyzer(db).analyze('زرق').length;
      check(n > 0 && db.provenance?.assetDigest === asset.assetDigest, `the ${label} Node entry's loadDatabase opens a compiled Asset from a path`, `${n} analyses`);
    } catch (e) {
      check(false, `the ${label} Node entry's loadDatabase opens a compiled Asset from a path`, e.message);
    }
  }
} catch (e) {
  check(false, 'shanisarf/compile compiles a tiny Asset', e.message);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// 10: no source maps.
const filesUnder = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
const built = has('dist') ? filesUnder(join(root, 'dist')) : [];
const maps = built.filter((f) => f.endsWith('.map'));
const naming = built.filter((f) => f.endsWith('.js') && /^\/\/# sourceMappingURL=/mu.test(readFileSync(f, 'utf8')));
check(
  built.length > 0 && maps.length === 0 && naming.length === 0,
  'dist/ holds no source map and no .js names one',
  maps.length + naming.length === 0 ? `${built.length} files` : `${maps.length} .map files, ${naming.length} .js naming one; left by an earlier build? npm run clean, then npm run build`,
);

console.log(failures.length === 0 ? '\ncheck:build — all checks passed.' : `\ncheck:build — ${failures.length} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
