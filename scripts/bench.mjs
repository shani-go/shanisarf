// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Performance comparison: the TypeScript port against CAMeL Tools 1.6.0 over
// the Database_Pin, the same words on both sides. It measures
//
//   - the port in process on Node (parse time, Retained_Memory and heap after
//     the source is dropped and gc() runs twice, µs per word);
//   - CAMeL Tools in process (tools/parity/bench_reference.py inproc);
//   - CAMeL Tools as a local HTTP service (bench_reference.py serve) called
//     from Node, at 1, 10, 100 and all words per request;
//   - with --browser, the port in a real page and the same service called
//     from that page: the script serves a bench page on 127.0.0.1, prints its
//     URL, and waits for the page to post its results back. The page is
//     cross-origin isolated (COOP same-origin, COEP require-corp) and reads
//     its memory with performance.measureUserAgentSpecificMemory() after
//     dropping the source, or reports it unavailable.
//
// The words are the committed parity Word_Lists (fixtures/wordlists/), read
// verbatim: split on "\n", drop a trailing "\r", skip empty and "#" lines.
// The cache is off on both sides (cacheSize 0 / cache_size=0), so every call
// does the full analysis. Every setup must return the same number of
// analyses; a mismatch fails the run, since a speed comparison between
// engines that disagree means nothing.
//
// Like measure:db, this skips with a notice and exits 0 when the database or
// the parity venv is absent. The service and the static server bind
// 127.0.0.1 only; the script makes no other network calls.
//
// This is a new-design developer script: project header only, no ported-code
// notice.
//
// Usage:
//   npm run build
//   npm run bench                         # Node + Python, print results
//   npm run bench -- --browser            # also open the printed URL
//
// The worker run speaks the Worker_Host's protocol to
// dist/esm/worker/entry-node.js under `worker_threads`, so each reply's
// `computeMs` is at hand: the model built from the text, then the Word_List
// words at 1, 10, 100 and all words per request (backoff `NONE`, cache
// off), reporting µs/word against the in-thread Analyzer in the same
// process, the request round trip, the host's compute time and the overhead
// per analysis (round trip minus compute, over the analyses). Every batch
// size must return the in-thread analysis count. With --browser the page also
// builds a Worker_Analyzer through `shanisarf/worker`'s web entry from
// transferred bytes and from text, recording the longest main-thread task
// during each (a `longtask` PerformanceObserver; tasks under 50 ms are not
// reported by the browser), and runs the same batches against entry-web.js.
//
// The Asset load rows. The Asset is packages/shanisarf-db-msa/asset/ when it
// is the expected one (its Manifest's SHA-256 is asset-digest.json's), else
// the pin compiled into a temporary directory. On Node: `loadDatabase(dir)`
// through the Node entry (`node:zlib`) and `openAsset` over bytes already in
// memory through the browser entry (`DecompressionStream`), each best of 3
// against the same run's `a` parse, best of 3; Retained_Memory after an `a`
// load (measure-db.mjs --asset --json, in its own process, the parse's
// method); and the Stored_Bytes. With --browser the page also reports
// `loadDatabase('asset/')` on the main thread, a worker Asset load
// (`{ source: { asset: 'asset/' } }`) and a worker parse of the text, each
// with its fetch, and the longest main-thread task during each. Every load
// must return the parse's analysis count.
//
// The Lexicon rows, from dist/esm/engine/lexicon.js over an `a` parse of the
// pin. Build: on a fresh Lexicon, each index timed as the first lookup that
// needs it, with a key no index holds, so nothing is materialized: the lemma
// Key_Index (built under `a`), the root Key_Index, the three folded indexes,
// and the entry-to-surface array (the first record), each best of 3, and
// their total against the same run's `a` parse, best of 3. Lookups: µs per
// lookup, best of 3 runs over the distinct keys of the `db-forms` words'
// analyses (backoff `NONE`, `source` `lex`): their `lex` values by lemma,
// their `stem` values without marks (`dediacAr`, alef wasla written bare, as
// the stem table writes surfaces) by stem, their `root` values by root, exact
// and folded, every index already built. Retained_Memory growth with every
// index built: this script re-run as a child (`--lexicon-child`, under
// --expose-gc) parses, drops the source and measures as measure-db.mjs does,
// builds every index, and measures again.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { cpus, tmpdir } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout, clearTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = join(repoRoot, 'data', 'camel-morph-msa', 'msa-v1.0.db');
const distDir = join(repoRoot, 'dist');
const builtIndex = join(distDir, 'esm', 'index.js');
const wordlistDir = join(repoRoot, 'fixtures', 'wordlists');
const benchPy = join(repoRoot, 'tools', 'parity', 'bench_reference.py');
const venvPython =
  process.platform === 'win32'
    ? join(repoRoot, 'tools', 'parity', '.venv', 'Scripts', 'python.exe')
    : join(repoRoot, 'tools', 'parity', '.venv', 'bin', 'python');
const measureDbScript = join(repoRoot, 'scripts', 'measure-db.mjs');
const builtNodeIndex = join(distDir, 'esm', 'index-node.js');
const builtCompile = join(distDir, 'esm', 'compile', 'index.js');
const pkgDir = join(repoRoot, 'packages', 'shanisarf-db-msa');
const builtLexicon = join(distDir, 'esm', 'engine', 'lexicon.js');
const benchScript = fileURLToPath(import.meta.url);

const BACKOFFS = ['NONE', 'NOAN_PROP'];
const WARMUP = 200;
const RUNS = 3;
const BROWSER_TIMEOUT_MS = 10 * 60 * 1000;
// How long the page waits for measureUserAgentSpecificMemory(), which
// resolves at a later garbage collection, before reporting it unavailable.
const PAGE_MEMORY_TIMEOUT_MS = 60 * 1000;

const args = new Set(process.argv.slice(2));
const withBrowser = args.has('--browser');
const builtWorkerEntry = join(distDir, 'esm', 'worker', 'entry-node.js');
const WORKER_SIZES = [1, 10, 100];

function skip(reason, fix) {
  console.error(`\nbench — SKIPPED: ${reason}\n\n${fix}\n\n  This is not a failure.\n`);
  process.exit(0);
}

function readWords(paths) {
  const words = [];
  for (const path of paths) {
    for (let line of readFileSync(path, 'utf8').split('\n')) {
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line && !line.startsWith('#')) words.push(line);
    }
  }
  return words;
}

async function nodeInproc(words) {
  const { parseAlmor, Analyzer } = await import(builtIndex);
  let text = readFileSync(dbPath, 'utf8');
  let t0 = performance.now();
  const db = parseAlmor(text, { flags: 'a' });
  const parseS = (performance.now() - t0) / 1e3;
  // The memory method of measure-db.mjs: drop the source, collect twice, and
  // report Retained_Memory (`heapUsed + external`) beside the heap.
  text = null;
  globalThis.gc?.();
  globalThis.gc?.();
  const mem = process.memoryUsage();
  const out = {
    parse_s: parseS,
    heap_mib: mem.heapUsed / 2 ** 20,
    retained_mib: (mem.heapUsed + mem.external) / 2 ** 20,
    rss_mib: mem.rss / 2 ** 20,
  };
  for (const backoff of BACKOFFS) {
    const analyzer = new Analyzer(db, { backoff, cacheSize: 0 });
    for (const w of words.slice(0, WARMUP)) analyzer.analyze(w);
    let best = Infinity;
    let n = 0;
    for (let r = 0; r < RUNS; r++) {
      t0 = performance.now();
      n = 0;
      for (const w of words) n += analyzer.analyze(w).length;
      best = Math.min(best, performance.now() - t0);
    }
    out[backoff] = { us_per_word: (best * 1e3) / words.length, analyses: n };
  }
  return out;
}

function pythonInproc(wordlists) {
  const r = spawnSync(venvPython, ['-I', benchPy, 'inproc', dbPath, ...wordlists], {
    encoding: 'utf8',
    maxBuffer: 1 << 20,
  });
  if (r.status !== 0) throw new Error(`bench_reference.py inproc failed:\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  for (const b of BACKOFFS) out[b] = { us_per_word: out[b].us_per_word, analyses: out[b].analyses };
  return out;
}

function startService() {
  return new Promise((resolve, reject) => {
    const proc = spawn(venvPython, ['-I', benchPy, 'serve', dbPath, '0'], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let buf = '';
    proc.on('exit', (code) => reject(new Error(`service exited early (${code})`)));
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl !== -1) resolve({ proc, port: JSON.parse(buf.slice(0, nl)).port });
    });
  });
}

// Shared by Node and the browser page (stringified into it), so both sides
// call the service the same way. text/plain avoids a CORS preflight per call.
async function serviceBatches(url, words, sizes) {
  const call = async (ws) =>
    (await globalThis.fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ words: ws }) })).json();
  const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))];
  for (const w of words.slice(0, 200)) await call([w]);
  const out = {};
  for (const size of sizes) {
    const lat = [];
    let n = 0;
    const t0 = performance.now();
    for (let i = 0; i < words.length; i += size) {
      const t = performance.now();
      const r = await call(words.slice(i, i + size));
      lat.push(performance.now() - t);
      n += r.reduce((s, x) => s + x.length, 0);
    }
    const total = performance.now() - t0;
    out[size] = { us_per_word: (total * 1e3) / words.length, req_p50_ms: pct(lat, 0.5), req_p95_ms: pct(lat, 0.95), analyses: n };
  }
  return out;
}

// Shared by Node and the browser page (stringified into it): the Word_List
// words through a Worker_Host, `send` posting one request and resolving
// with its reply. Size 1 is one `analyze` per word, larger sizes one
// `analyzeWords` per batch; each size reports its best of `runs`.
async function workerBatches(send, words, sizes, warmup, runs) {
  const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))];
  let id = 1000;
  const ask = async (request) => {
    const reply = await send({ ...request, id: id++ });
    if (!reply.ok) throw new Error(`worker: ${reply.error.name}: ${reply.error.message}`);
    return reply;
  };
  for (const word of words.slice(0, warmup)) await ask({ op: 'analyze', word });
  const out = {};
  for (const size of sizes) {
    let best = null;
    for (let r = 0; r < runs; r++) {
      const lat = [];
      let compute = 0;
      let analyses = 0;
      const t0 = performance.now();
      for (let i = 0; i < words.length; i += size) {
        const t = performance.now();
        if (size === 1) {
          const reply = await ask({ op: 'analyze', word: words[i] });
          analyses += reply.value.length;
          compute += reply.computeMs;
        } else {
          const reply = await ask({ op: 'analyzeWords', words: words.slice(i, i + size) });
          for (const x of reply.value) analyses += x.analyses.length;
          compute += reply.computeMs;
        }
        lat.push(performance.now() - t);
      }
      const total = performance.now() - t0;
      const row = {
        us_per_word: (total * 1e3) / words.length,
        round_trip_ms: total,
        compute_ms: compute,
        overhead_us_per_analysis: ((total - compute) * 1e3) / analyses,
        req_p50_ms: pct(lat, 0.5),
        analyses,
      };
      if (best === null || row.us_per_word < best.us_per_word) best = row;
    }
    out[size] = best;
  }
  return out;
}

/** Post requests to a `worker_threads` Worker and resolve each with its reply. */
function nodeSender(worker) {
  const pending = new Map();
  worker.on('message', (reply) => {
    const resolve = pending.get(reply.id);
    pending.delete(reply.id);
    resolve?.(reply);
  });
  worker.on('error', (error) => {
    for (const resolve of pending.values()) resolve({ ok: false, error: { name: error.name, message: error.message } });
    pending.clear();
  });
  return (request, transfer = []) =>
    new Promise((resolve) => {
      pending.set(request.id, resolve);
      worker.postMessage(request, transfer);
    });
}

/**
 * The worker run on Node: the in-thread Analyzer, then a Worker_Host given
 * the text, cloned into the worker and parsed there, through `workerBatches`
 * at `sizes` (and all words, with `all`).
 */
async function workerRun(words, { sizes, all }) {
  const { Worker } = await import('node:worker_threads');
  const { parseAlmor, Analyzer } = await import(builtIndex);
  const text = readFileSync(dbPath, 'utf8');
  const analyzer = new Analyzer(parseAlmor(text, { flags: 'a' }), { backoff: 'NONE', cacheSize: 0 });
  for (const w of words.slice(0, WARMUP)) analyzer.analyze(w);
  let best = Infinity;
  let analyses = 0;
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    let n = 0;
    for (const w of words) n += analyzer.analyze(w).length;
    best = Math.min(best, performance.now() - t0);
    analyses = n;
  }
  const out = { inThread: { us_per_word: (best * 1e3) / words.length, analyses }, sources: {} };
  const analyzerOptions = { backoff: 'NONE', cacheSize: 0 };
  const worker = new Worker(builtWorkerEntry);
  const send = nodeSender(worker);
  try {
    const row = {};
    const t0 = performance.now();
    const init = await send({ id: 1, op: 'init', source: { kind: 'text', text }, flags: 'a', analyzer: analyzerOptions });
    row.init_ms = performance.now() - t0;
    if (!init.ok) throw new Error(`worker init: ${init.error.name}: ${init.error.message}`);
    row.init_compute_ms = init.computeMs;
    row.batches = await workerBatches(send, words, all ? [...sizes, words.length] : sizes, WARMUP, RUNS);
    for (const [size, b] of Object.entries(row.batches)) {
      if (b.analyses !== analyses) {
        console.error(`\nbench — the worker at ${size} per request returned ${b.analyses} analyses, in thread ${analyses}; the run is void.`);
        process.exit(1);
      }
    }
    out.sources.text = row;
  } finally {
    await worker.terminate();
  }
  return out;
}

// ---------------------------------------------------------------------------
// The Asset load rows.
// ---------------------------------------------------------------------------

/**
 * The Asset to load: the data package's, when it is the expected one, else
 * the pin compiled into a temporary directory (removed at exit).
 */
async function assetDir() {
  const pkgAsset = join(pkgDir, 'asset');
  const expected = JSON.parse(readFileSync(join(pkgDir, 'asset-digest.json'), 'utf8')).assetDigest;
  const manifestPath = join(pkgAsset, 'manifest.json');
  if (existsSync(manifestPath) && createHash('sha256').update(readFileSync(manifestPath)).digest('hex') === expected) {
    return pkgAsset;
  }
  const { compileDatabaseFile } = await import(builtCompile);
  const dir = mkdtempSync(join(tmpdir(), 'shanisarf-bench-asset-'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  await compileDatabaseFile(dbPath, join(pkgDir, 'source.json'), dir);
  return dir;
}

/** The Asset's Shards: part, file, Shard_Content size and stored size. */
function assetFiles(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  return manifest.shards.map((s) => ({ part: s.part, path: s.path, size: s.size, stored: statSync(join(dir, s.path)).size }));
}

/** One measure-db.mjs --asset run in a child process, as its JSON record. */
function measureAssetMemory(dir, flags) {
  const r = spawnSync(process.execPath, ['--expose-gc', measureDbScript, '--asset', dir, '--flags', flags, '--json'], {
    encoding: 'utf8',
    maxBuffer: 1 << 20,
  });
  if (r.status !== 0) {
    throw new Error(`measure-db.mjs --asset ${dir} --flags ${flags} failed (exit ${r.status}):\n${r.stderr}`);
  }
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

/** Node: the `a` parse, `loadDatabase(dir)` and `openAsset(bytes)`, each best of RUNS, and the loaded model's analysis count. */
async function assetRun(words, dir) {
  const { loadDatabase, Analyzer } = await import(builtNodeIndex);
  const { openAsset, parseAlmor } = await import(builtIndex);
  const best = async (f) => {
    let ms = Infinity;
    let value = null;
    for (let r = 0; r < RUNS; r++) {
      const t0 = performance.now();
      value = await f();
      ms = Math.min(ms, performance.now() - t0);
    }
    return { ms, value };
  };
  const text = readFileSync(dbPath, 'utf8');
  const parse = await best(() => parseAlmor(text, { flags: 'a' }));
  const load = await best(() => loadDatabase(dir));
  const files = assetFiles(dir);
  const bytes = {
    manifest: new Uint8Array(readFileSync(join(dir, 'manifest.json'))),
    shards: Object.fromEntries(files.map((f) => [f.path, new Uint8Array(readFileSync(join(dir, f.path)))])),
  };
  const open = await best(() => openAsset(bytes));
  const analyzer = new Analyzer(load.value, { backoff: 'NONE', cacheSize: 0 });
  let analyses = 0;
  for (const w of words) analyses += analyzer.analyze(w).length;
  return {
    dir,
    files,
    storedBytes: files.reduce((n, f) => n + f.stored, 0),
    parse_ms: parse.ms,
    load_ms: load.ms,
    open_ms: open.ms,
    analyses,
  };
}

// ---------------------------------------------------------------------------
// The Lexicon rows.
// ---------------------------------------------------------------------------

const LOOKUP_KEYS = ['lemma', 'stem', 'root'];
// A key no index holds (no Arabic letter, so it folds to itself): a lookup
// with it builds the index it needs and materializes nothing.
const ABSENT_KEY = '\u0000';

/** The distinct lemma, stem and root keys of the `db-forms` words' analyses with `source` `lex`. */
function lexiconKeys(Analyzer, dediacAr, db) {
  const words = readWords([join(wordlistDir, 'db-forms.words.txt')]);
  const analyzer = new Analyzer(db, { backoff: 'NONE', cacheSize: 0 });
  const keys = { lemma: new Set(), stem: new Set(), root: new Set() };
  for (const word of words) {
    for (const a of analyzer.analyze(word)) {
      if (a.source !== 'lex') continue;
      if (typeof a.lex === 'string') keys.lemma.add(a.lex);
      if (typeof a.stem === 'string') keys.stem.add(dediacAr(a.stem).replaceAll('ٱ', 'ا'));
      if (typeof a.root === 'string') keys.root.add(a.root);
    }
  }
  return { words: words.length, lemma: [...keys.lemma], stem: [...keys.stem], root: [...keys.root] };
}

/** The steps that build the Lexicon's indexes on a fresh instance, in order. */
const LEXICON_BUILDS = [
  ['lemma Key_Index (built under `a`)', (lx) => lx.lookup('lemma', ABSENT_KEY)],
  ['root Key_Index', (lx) => lx.lookup('root', ABSENT_KEY)],
  ['folded lemma index', (lx) => lx.lookup('lemma', ABSENT_KEY, { fold: true })],
  ['folded stem index', (lx) => lx.lookup('stem', ABSENT_KEY, { fold: true })],
  ['folded root index', (lx) => lx.lookup('root', ABSENT_KEY, { fold: true })],
];

/** Build every index on `lexicon`; `firstStem` is a stem key the table holds, whose lookup builds the entry-to-surface array. */
function buildEveryIndex(lexicon, firstStem) {
  for (const [, step] of LEXICON_BUILDS) step(lexicon);
  lexicon.lookup('stem', firstStem);
}

/** Node: the `a` parse, each index's build time and the lookup latencies, best of RUNS each. */
async function lexiconRun() {
  const { parseAlmor, Analyzer, dediacAr } = await import(builtIndex);
  const { Lexicon } = await import(builtLexicon);
  const text = readFileSync(dbPath, 'utf8');
  let parseMs = Infinity;
  let db = null;
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    db = parseAlmor(text, { flags: 'a' });
    parseMs = Math.min(parseMs, performance.now() - t0);
  }
  const keys = lexiconKeys(Analyzer, dediacAr, db);
  const firstStem = keys.stem[0];
  const steps = [...LEXICON_BUILDS, ['entry-to-surface array (first record)', (lx) => lx.lookup('stem', firstStem)]];
  const builds = steps.map(([name]) => ({ name, ms: Infinity }));
  let totalMs = Infinity;
  for (let r = 0; r < RUNS; r++) {
    const lexicon = new Lexicon(db);
    let total = 0;
    steps.forEach(([, step], i) => {
      const t0 = performance.now();
      step(lexicon);
      const dt = performance.now() - t0;
      builds[i].ms = Math.min(builds[i].ms, dt);
      total += dt;
    });
    totalMs = Math.min(totalMs, total);
  }
  const lexicon = new Lexicon(db);
  buildEveryIndex(lexicon, firstStem);
  const lookups = [];
  for (const by of LOOKUP_KEYS) {
    for (const fold of [false, true]) {
      const list = keys[by];
      const options = { fold };
      let best = Infinity;
      let records = 0;
      let found = 0;
      for (let r = 0; r < RUNS; r++) {
        records = 0;
        found = 0;
        const t0 = performance.now();
        for (const key of list) {
          const n = lexicon.lookup(by, key, options).length;
          records += n;
          if (n > 0) found++;
        }
        best = Math.min(best, performance.now() - t0);
      }
      lookups.push({ by, fold, keys: list.length, found, records, us: (best * 1e3) / list.length });
    }
  }
  return { size: lexicon.size, words: keys.words, parse_ms: parseMs, builds, total_ms: totalMs, lookups };
}

/**
 * The child (`--lexicon-child`, under --expose-gc): Retained_Memory after an
 * `a` parse with the source dropped, then after every index is built, by the
 * method of measure-db.mjs (`heapUsed + external` after two collections).
 */
async function lexiconChild() {
  const { parseAlmor } = await import(builtIndex);
  const { Lexicon } = await import(builtLexicon);
  const retained = () => {
    globalThis.gc();
    globalThis.gc();
    const m = process.memoryUsage();
    return m.heapUsed + m.external;
  };
  let text = readFileSync(dbPath, 'utf8');
  const db = parseAlmor(text, { flags: 'a' });
  retained();
  text = null;
  const lexicon = new Lexicon(db);
  const before = retained();
  const firstStem = lexicon.entries({ features: [] }).next().value.surface;
  buildEveryIndex(lexicon, firstStem);
  const after = retained();
  console.log(JSON.stringify({ size: lexicon.size, beforeMiB: before / 2 ** 20, afterMiB: after / 2 ** 20, growthMiB: (after - before) / 2 ** 20 }));
}

/** The Lexicon memory child's JSON record. */
function measureLexiconMemory() {
  const r = spawnSync(process.execPath, ['--expose-gc', benchScript, '--lexicon-child'], { encoding: 'utf8', maxBuffer: 1 << 20 });
  if (r.status !== 0) throw new Error(`bench.mjs --lexicon-child failed (exit ${r.status}):\n${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

/** The Lexicon rows. */
function lexiconReport(lx) {
  const ratioOf = (x) => `${(x / lx.parse_ms).toFixed(3)}×`;
  const buildMs = (x) => `${x.toFixed(1)} ms`;
  return [
    `Lexicon: ${lx.size.toLocaleString('en-US')} stem entries, \`a\` parse ${ms(lx.parse_ms)} (best of ${RUNS}). ` +
      `Each index built on a fresh Lexicon by the first lookup that needs it, best of ${RUNS}.`,
    '',
    '| Build | Time | vs the `a` parse |',
    '|---|---|---|',
    ...lx.builds.map((b) => `| ${b.name} | ${buildMs(b.ms)} | ${ratioOf(b.ms)} |`),
    `| **Every index** (best total) | ${buildMs(lx.total_ms)} | ${ratioOf(lx.total_ms)} |`,
    '',
    `Lookups over the distinct keys of the ${lx.words.toLocaleString('en-US')} \`db-forms\` words' analyses (backoff \`NONE\`, \`source\` \`lex\`), every index built, best of ${RUNS}:`,
    '',
    '| Lookup | Keys | Found | Records | µs per lookup | µs per record |',
    '|---|---|---|---|---|---|',
    ...lx.lookups.map(
      (l) =>
        `| by ${l.by}, ${l.fold ? 'folded' : 'exact'} | ${l.keys.toLocaleString('en-US')} | ${l.found.toLocaleString('en-US')} | ${l.records.toLocaleString('en-US')} | ${l.us.toFixed(2)} | ${((l.us * l.keys) / l.records).toFixed(2)} |`,
    ),
    '',
    `Retained_Memory growth with every index built: ${lx.memory.growthMiB.toFixed(1)} MiB ` +
      `(${lx.memory.beforeMiB.toFixed(1)} → ${lx.memory.afterMiB.toFixed(1)} MiB; a child process, measure-db.mjs's method).`,
  ].join('\n');
}

const BENCH_PAGE = (servicePort) => `<!doctype html><meta charset="utf-8"><title>shanisarf bench</title>
<pre id="o">running… keep this tab in front until it says done.</pre>
<script type="module">
const o = document.getElementById('o');
const R = { ua: navigator.userAgent };
const show = () => (o.textContent = JSON.stringify(R, null, 1));
const serviceBatches = ${serviceBatches.toString()};
const { parseAlmor, Analyzer } = await import('./dist/esm/index.js');
const words = await (await fetch('words.json')).json();
let t = performance.now();
let text = await (await fetch('msa.db', { cache: 'no-store' })).text();
R.fetch_s = (performance.now() - t) / 1e3;
t = performance.now();
const db = parseAlmor(text, { flags: 'a' });
R.parse_s = (performance.now() - t) / 1e3;
// The memory method in the page: drop the source, then
// measureUserAgentSpecificMemory(), which needs a cross-origin-isolated page
// (the COOP/COEP headers below) and resolves at a later garbage collection.
// Where it is absent or times out, the memory is reported unavailable;
// performance.memory is never read.
text = null;
R.cross_origin_isolated = globalThis.crossOriginIsolated === true;
if (!R.cross_origin_isolated) {
  R.memory_unavailable = 'the page is not cross-origin isolated';
} else if (typeof performance.measureUserAgentSpecificMemory !== 'function') {
  R.memory_unavailable = 'measureUserAgentSpecificMemory() is absent';
} else {
  show();
  const timedOut = new Promise((resolve) => setTimeout(() => resolve(null), ${PAGE_MEMORY_TIMEOUT_MS}));
  try {
    const m = await Promise.race([performance.measureUserAgentSpecificMemory(), timedOut]);
    if (m === null) R.memory_unavailable = 'measureUserAgentSpecificMemory() timed out';
    else R.memory_mib = m.bytes / 2 ** 20;
  } catch (e) {
    // Chromium refuses it (SecurityError) where it cannot lock the page's
    // process to its site, for instance in some embedded browsers.
    R.memory_unavailable = 'measureUserAgentSpecificMemory() refused (' + e.name + ')';
    R.memory_error = String(e);
  }
}
show();
for (const backoff of ${JSON.stringify(BACKOFFS)}) {
  const a = new Analyzer(db, { backoff, cacheSize: 0 });
  for (const w of words.slice(0, ${WARMUP})) a.analyze(w);
  let best = Infinity, n = 0;
  for (let r = 0; r < ${RUNS}; r++) {
    t = performance.now(); n = 0;
    for (const w of words) n += a.analyze(w).length;
    best = Math.min(best, performance.now() - t);
  }
  R[backoff] = { us_per_word: best * 1e3 / words.length, analyses: n };
  show();
}
// The longest main-thread task in a span (the browser reports tasks of 50 ms
// and more), for the worker and Asset rows.
const longTasks = [];
let observer = null;
if (typeof PerformanceObserver === 'function' && (PerformanceObserver.supportedEntryTypes || []).includes('longtask')) {
  observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) longTasks.push(e); });
  observer.observe({ type: 'longtask' });
}
const longestIn = async (t0, t1) => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (observer === null) return null;
  let max = 0;
  for (const e of longTasks) if (e.startTime >= t0 && e.startTime <= t1) max = Math.max(max, e.duration);
  return max;
};
const { createWorkerAnalyzer } = await import('./dist/esm/worker/web.js');
// The worker: a Worker_Analyzer through shanisarf/worker's web entry from
// transferred bytes and from text, with the longest main-thread task while
// each builds, then the protocol batches against entry-web.js.
try {
  const workerBatches = ${workerBatches.toString()};
  R.worker = {};
  for (const kind of ['bytes', 'text']) {
    const response = await fetch('msa.db', { cache: 'no-store' });
    const source = kind === 'bytes' ? await response.arrayBuffer() : await response.text();
    const t0 = performance.now();
    const wa = await createWorkerAnalyzer({ source, transfer: kind === 'bytes', analyzer: { cacheSize: 0 } });
    const t1 = performance.now();
    let analyses = 0;
    for (const x of await wa.analyzeWords(words)) analyses += x.analyses.length;
    await wa.terminate();
    R.worker[kind] = { init_s: (t1 - t0) / 1e3, longest_task_ms: await longestIn(t0, t1), analyses };
    show();
  }
  const worker = new Worker('./dist/esm/worker/entry-web.js', { type: 'module' });
  const pending = new Map();
  worker.addEventListener('message', (e) => { const f = pending.get(e.data.id); pending.delete(e.data.id); if (f) f(e.data); });
  const send = (request, transfer) => new Promise((resolve) => { pending.set(request.id, resolve); worker.postMessage(request, transfer || []); });
  const bytes = await (await fetch('msa.db', { cache: 'no-store' })).arrayBuffer();
  const init = await send({ id: 1, op: 'init', source: { kind: 'bytes', bytes }, flags: 'a', analyzer: { backoff: 'NONE', cacheSize: 0 } }, [bytes]);
  if (!init.ok) throw new Error(init.error.name + ': ' + init.error.message);
  R.worker.batches = await workerBatches(send, words, [1, 10, 100, words.length], ${WARMUP}, ${RUNS});
  worker.terminate();
} catch (e) {
  R.worker_error = String(e && e.stack || e);
}
show();
// The Asset: loadDatabase on the main thread, a worker from the Asset, and a
// worker from the text, each with its fetch, and the longest main-thread task
// during each.
try {
  const { loadDatabase } = await import('./dist/esm/index.js');
  const count = (results) => results.reduce((n, x) => n + x.analyses.length, 0);
  R.asset = {};
  let t0 = performance.now();
  const adb = await loadDatabase('asset/');
  let t1 = performance.now();
  // Yield before analyzing, so the analysis below runs in a task of its own
  // and the longest task in [t0, t1] is the load's.
  await new Promise((resolve) => setTimeout(resolve, 0));
  let analyses = 0;
  const a = new Analyzer(adb, { backoff: 'NONE', cacheSize: 0 });
  for (const w of words) analyses += a.analyze(w).length;
  R.asset.main = { ready_s: (t1 - t0) / 1e3, longest_task_ms: await longestIn(t0, t1), analyses, provenance: adb.provenance };
  show();
  for (const [key, source] of [['worker', null], ['text_worker', 'text']]) {
    t0 = performance.now();
    const src = source === null ? { asset: 'asset/' } : await (await fetch('msa.db', { cache: 'no-store' })).text();
    const wa = await createWorkerAnalyzer({ source: src, analyzer: { backoff: 'NONE', cacheSize: 0 } });
    t1 = performance.now();
    R.asset[key] = { ready_s: (t1 - t0) / 1e3, longest_task_ms: await longestIn(t0, t1), analyses: count(await wa.analyzeWords(words)) };
    await wa.terminate();
    show();
  }
} catch (e) {
  R.asset_error = String(e && e.stack || e);
}
show();
R.service = await serviceBatches('http://127.0.0.1:${servicePort}/analyze', words, [1, 10, words.length]);
await fetch('results', { method: 'POST', body: JSON.stringify(R) });
R.done = true;
show();
</script>`;

const MIME = { '.js': 'text/javascript', '.map': 'application/json', '.ts': 'text/plain' };

function browserRun(words, servicePort, asset) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for the browser page')), BROWSER_TIMEOUT_MS);
    const server = createServer((req, res) => {
      // Cross-origin isolation, for measureUserAgentSpecificMemory() in the
      // page. Every response here is same-origin; the CAMeL Tools service on
      // its own port is fetched in CORS mode and answers with
      // Access-Control-Allow-Origin, which require-corp accepts.
      res.setHeader('cross-origin-opener-policy', 'same-origin');
      res.setHeader('cross-origin-embedder-policy', 'require-corp');
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (req.method === 'POST' && path === '/results') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          res.end('ok');
          clearTimeout(timer);
          server.close();
          resolve(JSON.parse(body));
        });
        return;
      }
      if (path === '/') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        return res.end(BENCH_PAGE(servicePort));
      }
      if (path === '/words.json') {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify(words));
      }
      let file = null;
      if (path === '/msa.db') file = dbPath;
      else if (path.startsWith('/asset/')) {
        const candidate = normalize(join(asset, path.slice('/asset/'.length)));
        if (candidate.startsWith(asset + sep)) file = candidate;
        res.setHeader('cache-control', 'no-store');
      }
      else if (path.startsWith('/dist/')) {
        const candidate = normalize(join(distDir, path.slice('/dist/'.length)));
        if (candidate.startsWith(distDir + sep)) file = candidate;
      }
      if (!file || !existsSync(file) || !statSync(file).isFile()) {
        res.statusCode = 404;
        return res.end();
      }
      res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
      res.setHeader('content-length', statSync(file).size);
      createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      console.log(`\nOpen this page in a browser and keep its tab in front:\n\n    http://127.0.0.1:${server.address().port}/\n`);
      console.log('Waiting for its results ...');
    });
  });
}

function transferSizes() {
  const raw = readFileSync(dbPath);
  return {
    raw: raw.length,
    gzip9: gzipSync(raw, { level: 9 }).length,
    brotli11: brotliCompressSync(raw, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length },
    }).length,
  };
}

const us = (x) => `${Math.round(x).toLocaleString('en-US')} µs`;
const s = (x) => `${x.toFixed(2)} s`;
const mib = (x) => `${Math.round(x).toLocaleString('en-US')} MiB`;
const mb = (x) => `${(x / 1e6).toFixed(1)} MB`;

function report(r) {
  const base = r.browser ? r.browser.NONE.us_per_word : r.node.NONE.us_per_word;
  const baseName = r.browser ? 'in-page port' : 'port on Node';
  const rel = (x) => `${(x / base).toFixed(1)}×`;
  const rows = [];
  const row = (setup, none, prop, extra = '') => rows.push(`| ${setup} | ${us(none)} | ${prop == null ? '—' : us(prop)} | ${rel(none)} | ${extra} |`);
  if (r.browser) row(`Port, in page (${r.browserName})`, r.browser.NONE.us_per_word, r.browser.NOAN_PROP.us_per_word);
  row(`Port, in process (Node ${r.env.node})`, r.node.NONE.us_per_word, r.node.NOAN_PROP.us_per_word);
  row(`CAMeL Tools, in process (Python ${r.python.python})`, r.python.NONE.us_per_word, r.python.NOAN_PROP.us_per_word);
  const svc = (who, batches) => {
    for (const [size, b] of Object.entries(batches).sort((a, b) => Number(b[0]) - Number(a[0]))) {
      const label = Number(size) === r.words ? 'all words in one request' : `${size} word${size === '1' ? '' : 's'} per request`;
      row(`CAMeL Tools service from ${who}, ${label}`, b.us_per_word, null, `request p50 ${b.req_p50_ms.toFixed(1)} ms, p95 ${b.req_p95_ms.toFixed(1)} ms`);
    }
  };
  if (r.browser) svc('the page', r.browser.service);
  svc('Node', r.service);

  const startup = [
    `| Port, in page | ${r.browser ? `${s(r.browser.fetch_s)} fetch (localhost) + ${s(r.browser.parse_s)} parse` : '—'} | ${
      !r.browser
        ? '—'
        : r.browser.memory_mib != null
          ? `${mib(r.browser.memory_mib)} (\`measureUserAgentSpecificMemory\`, source dropped)`
          : `unavailable: ${r.browser.memory_unavailable}`
    } |`,
    `| Port, on Node | ${s(r.node.parse_s)} parse | ${mib(r.node.retained_mib)} retained (${mib(r.node.heap_mib)} heap), ${mib(r.node.rss_mib)} RSS |`,
    `| CAMeL Tools | ${s(r.python.load_s)} load | ${mib(r.python.rss_mib_after_load)} RSS after load |`,
  ];
  return [
    `Recorded by \`npm run bench\` on ${r.env.date}: ${r.env.cpu}, Node ${r.env.node}, ` +
      `Python ${r.python.python}, CAMeL Tools 1.6.0${r.browser ? `, ${r.browserName}` : ''}. ` +
      `${r.words.toLocaleString('en-US')} words (the committed parity Word_Lists), cache off, best of ${RUNS} runs. ` +
      `Every setup returned ${r.analyses.NONE.toLocaleString('en-US')} analyses with backoff \`NONE\` ` +
      `and ${r.analyses.NOAN_PROP.toLocaleString('en-US')} with \`NOAN_PROP\`.`,
    '',
    `| Setup | µs/word, \`NONE\` | µs/word, \`NOAN_PROP\` | vs ${baseName} | Notes |`,
    '|---|---|---|---|---|',
    ...rows,
    '',
    '| Startup | Database load | Memory |',
    '|---|---|---|',
    ...startup,
    '',
    `Database transfer size: ${mb(r.sizes.raw)} raw, ${mb(r.sizes.gzip9)} gzip -9, ${mb(r.sizes.brotli11)} Brotli q11.`,
    ...(r.browser ? [] : ['', '_In-page rows absent: re-run with `--browser` to record them._']),
    '',
    workerReport(r.worker, r.browser, r.words),
    '',
    assetReport(r.asset, r.browser),
    '',
    lexiconReport(r.lexicon),
  ].join('\n');
}

/** The Asset load rows: Node, and the page's when present. */
function assetReport(a, browser) {
  const ratio = (x) => `${(x / a.parse_ms).toFixed(2)}×`;
  const shards = a.files.map((f) => `\`${f.path}\` ${f.stored.toLocaleString('en-US')} B stored (${f.size.toLocaleString('en-US')} B inflated)`).join(', ');
  const out = [
    `Asset: Stored_Bytes ${a.storedBytes.toLocaleString('en-US')} B in total: ${shards}. ` +
      `Times are best of ${RUNS}, against the same run's \`a\` parse; every load returned the parse's analysis count.`,
    '',
    '| On Node | Time | vs the `a` parse |',
    '|---|---|---|',
    `| \`loadDatabase(dir)\`, Node entry (\`node:zlib\`, files read from disk) | ${ms(a.load_ms)} | ${ratio(a.load_ms)} |`,
    `| \`openAsset(bytes)\`, browser entry (\`DecompressionStream\`), bytes in memory | ${ms(a.open_ms)} | ${ratio(a.open_ms)} |`,
    `| \`parseAlmor(text, { flags: 'a' })\` | ${ms(a.parse_ms)} | 1.00× |`,
    '',
    `Retained_Memory after an \`a\` load: ${a.memory.load.toFixed(1)} MiB, against ${a.memory.parse.toFixed(1)} MiB after an \`a\` parse ` +
      `(${(a.memory.load / a.memory.parse).toFixed(2)}×; measure-db.mjs in its own process each).`,
  ];
  if (browser?.asset_error) {
    out.push('', `_In-page Asset run failed: ${browser.asset_error.split('\n')[0]}_`);
  } else if (browser?.asset) {
    const longest = (x) => (x === null ? 'unavailable (no `longtask` entries in this browser)' : x === 0 ? 'none of 50 ms or more' : `${x.toFixed(0)} ms`);
    const pa = browser.asset;
    out.push(
      '',
      '| In page, fetch included | Ready after | Longest main-thread task meanwhile |',
      '|---|---|---|',
      `| \`loadDatabase('asset/')\` on the main thread | ${s(pa.main.ready_s)} | ${longest(pa.main.longest_task_ms)} |`,
      `| Worker from the Asset (\`{ source: { asset: 'asset/' } }\`) | ${s(pa.worker.ready_s)} | ${longest(pa.worker.longest_task_ms)} |`,
      `| Worker from the text (\`msa.db\` fetched as text) | ${s(pa.text_worker.ready_s)} | ${longest(pa.text_worker.longest_task_ms)} |`,
      '',
      `In page, the worker Asset load took ${(pa.worker.ready_s / pa.text_worker.ready_s).toFixed(2)}× the worker parse of the text.`,
    );
  }
  return out.join('\n');
}

const ms = (x) => (x >= 1000 ? `${(x / 1e3).toFixed(2)} s` : `${Math.round(x).toLocaleString('en-US')} ms`);

/** The worker rows: Node, and the page's when present. */
function workerReport(w, browser, wordCount) {
  const label = (size) => (Number(size) === wordCount ? 'all words' : `${size} word${size === '1' ? '' : 's'}`);
  const rows = [];
  const batchRows = (setup, built, batches, inThread) => {
    Object.entries(batches).forEach(([size, b], i) => {
      rows.push(
        `| ${i === 0 ? setup : ''} | ${i === 0 ? built : ''} | ${label(size)} | ${b.us_per_word.toFixed(0)} | ${(b.us_per_word / inThread).toFixed(2)}× | ${b.req_p50_ms.toFixed(2)} ms | ${b.overhead_us_per_analysis.toFixed(2)} µs |`,
      );
    });
  };
  const row = w.sources.text;
  batchRows('Node, from the text', `${ms(row.init_ms)}: the text cloned in, ${ms(row.init_compute_ms)} parsing in the worker`, row.batches, w.inThread.us_per_word);
  const out = [
    `Worker: the Word_List words through the Worker_Host's protocol (\`entry-node.js\` from dist/ under \`worker_threads\`), backoff \`NONE\`, cache off, best of ${RUNS} runs; every request size returned the in-thread analysis count. In thread, same process: ${w.inThread.us_per_word.toFixed(0)} µs/word. Overhead per analysis is the round trip minus the host's compute time, over the analyses.`,
    '',
    '| Setup | Model built | Per request | µs/word | vs in thread | Request p50 | Overhead per analysis |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ];
  if (browser?.worker_error) {
    out.push('', `_In-page worker run failed: ${browser.worker_error.split('\n')[0]}_`);
  } else if (browser?.worker) {
    const pw = browser.worker;
    const longest = (x) => (x === null ? 'unavailable (no `longtask` entries in this browser)' : x === 0 ? 'none of 50 ms or more' : `${x.toFixed(0)} ms`);
    out.push(
      '',
      '| In page | Worker_Analyzer ready after | Longest main-thread task meanwhile |',
      '|---|---|---|',
      `| From transferred bytes | ${s(pw.bytes.init_s)} | ${longest(pw.bytes.longest_task_ms)} |`,
      `| From text | ${s(pw.text.init_s)} | ${longest(pw.text.longest_task_ms)} |`,
    );
    rows.length = 0;
    batchRows('In page, from transferred bytes', '', pw.batches, browser.NONE.us_per_word);
    out.push(
      '',
      'In page, the same batches against `entry-web.js` (vs the in-page in-thread Analyzer):',
      '',
      '| Setup | | Per request | µs/word | vs in thread | Request p50 | Overhead per analysis |',
      '|---|---|---|---|---|---|---|',
      ...rows,
    );
  }
  return out.join('\n');
}

/** One measure-db.mjs run in a child process, as its JSON record. */
function measureMemory(flags) {
  const r = spawnSync(process.execPath, ['--expose-gc', measureDbScript, '--flags', flags, '--json'], {
    encoding: 'utf8',
    maxBuffer: 1 << 20,
  });
  if (r.status !== 0) {
    throw new Error(`measure-db.mjs --flags ${flags} failed (exit ${r.status}):\n${r.stderr}`);
  }
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

async function main() {
  if (args.has('--lexicon-child')) {
    await lexiconChild();
    return;
  }
  if (!existsSync(dbPath)) skip('the Database_Pin is not present.', '      npm run parity:setup      # fetches the DB into data/');
  if (!existsSync(venvPython)) skip('the parity venv is not present.', '      npm run parity:setup      # builds tools/parity/.venv');
  if (!existsSync(builtIndex)) {
    console.error(`\nbench — the built engine was not found at ${builtIndex}. Run \`npm run build\` first.\n`);
    process.exit(1);
  }

  const wordlists = readdirSync(wordlistDir).filter((f) => f.endsWith('.words.txt')).sort().map((f) => join(wordlistDir, f));
  const words = readWords(wordlists);
  console.log(`bench — ${words.length.toLocaleString('en-US')} words from ${wordlists.length} Word_Lists`);

  console.log('Port on Node ...');
  const node = await nodeInproc(words);
  console.log('Worker on Node ...');
  const worker = await workerRun(words, { sizes: WORKER_SIZES, all: true });
  console.log('Asset loads on Node ...');
  const asset = await assetRun(words, await assetDir());
  asset.memory = {
    parse: measureMemory('a').memory.retainedMiB,
    load: measureAssetMemory(asset.dir, 'a').memory.retainedMiB,
  };
  console.log('Lexicon on Node ...');
  const lexicon = await lexiconRun();
  lexicon.memory = measureLexiconMemory();
  console.log('CAMeL Tools in process ...');
  const python = pythonInproc(wordlists);
  console.log('CAMeL Tools service ...');
  const { proc, port } = await startService();
  let service;
  let browser = null;
  try {
    service = await serviceBatches(`http://127.0.0.1:${port}/analyze`, words, [1, 10, 100, words.length]);
    if (withBrowser) browser = await browserRun(words, port, asset.dir);
  } finally {
    proc.removeAllListeners('exit');
    proc.kill();
  }
  console.log('Database transfer sizes ...');
  const sizes = transferSizes();

  // Every setup must agree on the analysis counts.
  const counts = { NONE: [], NOAN_PROP: [] };
  for (const b of BACKOFFS) {
    counts[b].push(['node', node[b].analyses], ['python', python[b].analyses]);
    if (browser) counts[b].push(['browser', browser[b].analyses]);
  }
  for (const [size, x] of Object.entries(service)) counts.NONE.push([`service/${size}`, x.analyses]);
  for (const [size, x] of Object.entries(browser?.service ?? {})) counts.NONE.push([`page→service/${size}`, x.analyses]);
  counts.NONE.push(['worker in-thread', worker.inThread.analyses]);
  for (const [source, row] of Object.entries(worker.sources)) {
    for (const [size, x] of Object.entries(row.batches)) counts.NONE.push([`worker/${source}/${size}`, x.analyses]);
  }
  for (const kind of ['bytes', 'text']) {
    if (browser?.worker?.[kind]) counts.NONE.push([`page worker/${kind}`, browser.worker[kind].analyses]);
  }
  for (const [size, x] of Object.entries(browser?.worker?.batches ?? {})) counts.NONE.push([`page worker/${size}`, x.analyses]);
  counts.NONE.push(['asset load', asset.analyses]);
  for (const key of ['main', 'worker', 'text_worker']) {
    if (browser?.asset?.[key]) counts.NONE.push([`page asset/${key}`, browser.asset[key].analyses]);
  }
  const mismatched = BACKOFFS.filter((b) => new Set(counts[b].map(([, n]) => n)).size !== 1);
  if (mismatched.length > 0) {
    console.error('\nbench — the setups disagree on analysis counts; the comparison is void:');
    for (const b of mismatched) console.error(`  ${b}: ${counts[b].map(([k, n]) => `${k}=${n}`).join(', ')}`);
    process.exit(1);
  }

  const browserName = browser ? (/Chrome\/(\d+)/.exec(browser.ua) ? `Chromium ${/Chrome\/(\d+)/.exec(browser.ua)[1]}` : browser.ua) : null;
  const block = report({
    env: { date: new Date().toISOString().slice(0, 10), cpu: cpus()[0]?.model ?? process.arch, node: process.version },
    words: words.length,
    analyses: { NONE: node.NONE.analyses, NOAN_PROP: node.NOAN_PROP.analyses },
    node,
    python,
    service,
    browser,
    browserName,
    sizes,
    worker,
    asset,
    lexicon,
  });
  console.log(`\n${block}`);
}

main().catch((error) => {
  console.error('\nbench — unexpected error:');
  console.error(error);
  process.exit(1);
});
