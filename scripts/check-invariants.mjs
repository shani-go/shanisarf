// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The report-only invariant check. It runs five guards over the committed
// text, the NOTICE rows, the ported-code notices, the library's network
// surface and the data package, reports what each finds, and never edits:
//
//   1. scan_text  — run tools/parity/scan_text.py over every committed
//                   Word_List (fixtures/wordlists/*.words.txt) and every
//                   Request_List (fixtures/wordlists/*.requests.jsonl): no
//                   interior space, no line over 32 code points, no
//                   terminator inside a word, and a Request_List line's JSON
//                   shape. A failure means a committed list may carry running
//                   text.
//   2. notice-rows — every Word_List, every Request_List and every
//                   third-party input in REQUIRED_NOTICE_INPUTS, the
//                   generated typed features module (src/msa-features.ts)
//                   among them, has a row in NOTICE. A failure means an input
//                   landed without its attribution.
//   3. ported-notice — list any ported `.ts` file under src/engine/ that
//                   lacks the ported-code notice (the rule is in
//                   CONTRIBUTING.md); the NEW_DESIGN_BASENAMES list below is
//                   the authority for which files are exempt. It also notes any file under
//                   src/worker/ or src/align/ that carries the notice, since
//                   both are new design throughout.
//   4. no-network — list any `fetch(`, `XMLHttpRequest`, `WebSocket`,
//                   `EventSource`, `sendBeacon`, `importScripts(`, dynamic
//                   `import(` (which could load a URL) or a `node:` network
//                   module anywhere in src/, comments and tests aside.
//                   `fetch` is allowed only in the loader's two read modules,
//                   src/load/read-asset.ts and src/load/read-asset-node.ts:
//                   loading a database is the caller's explicit act, and
//                   nothing else requests.
//   5. data-package — the Camel Morph attribution text and citation in
//                   packages/shanisarf-db-msa/source.json and its NOTICE
//                   equal the root NOTICE's, runs of whitespace compared as
//                   one space; no file under packages/ that git would commit
//                   (tracked, or untracked and not ignored) has the
//                   Database_Pin's size or content SHA-256; no package name,
//                   `exports` key, entry export name or file name of the
//                   packages, the loader, the compiler or the demo contains
//                   `camel` or `calima`, in any case (file contents, such as
//                   the attribution, are not checked); and a note for any
//                   file under src/load/ or src/compile/ that carries the
//                   ported-code notice (both are new design).
//
// REPORT-ONLY. This script edits NOTHING. It reads files, prints what it
// finds, and conveys pass/fail only through its exit code (0 = clean, 1 = at
// least one issue reported, 2 = usage/environment problem). It never writes,
// moves, deletes or rewrites a file, like all automation in this repository
// (CONTRIBUTING.md: automation is local and report-only). Run it by hand or
// from a pre-commit hook.
//
// This is a new-design developer script: project header only, no ported-code
// notice.
//
// Usage:
//   node scripts/check-invariants.mjs      # or: npm run check:invariants
//
// The scan_text sub-check needs a Python 3 interpreter. SHANISARF_PARITY_PYTHON,
// when set, names it: a release worktree has no venv of its own and points
// this at the main tree's (docs/npm-release.md, G3), and a path that
// does not exist fails the check rather than skipping it. Otherwise it
// prefers the parity venv's interpreter (tools/parity/.venv) when present,
// else a system `python3`/`python`. When no interpreter is found it reports
// scan_text as SKIPPED (not a failure) and still runs the other checks, so
// the guard is useful on a machine without the venv.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const wordlistDir = join(repoRoot, 'fixtures', 'wordlists');
const scanText = join(repoRoot, 'tools', 'parity', 'scan_text.py');
const noticePath = join(repoRoot, 'NOTICE');
const engineDir = join(repoRoot, 'src', 'engine');
const workerDir = join(repoRoot, 'src', 'worker');
const alignDir = join(repoRoot, 'src', 'align');

// The marker the ported-code notice rule (CONTRIBUTING.md) requires as the first comment of
// every ported or structurally-similar file.
const PORTED_NOTICE_MARKER = 'Ported from CAMeL Tools';

// Files under src/engine/ that are NEW DESIGN, so they carry the project
// header only and are NOT expected to have the ported-code notice. This list
// is the authority for which engine files are exempt; it mirrors the
// notice check's exclusions (`python-compat|almor-serializer|lfu-cache|
// string-table|feature-schema|compat-bitset|model-views|model-codec|lexicon|
// key-fold|index\.ts`):
//   - python-compat.ts  (stringutils' force_unicode is moot; new helpers)
//   - almor-serializer.ts (new-design serializer)
//   - lfu-cache.ts        (new-design cache)
//   - string-table.ts     (the String_Table, new design)
//   - feature-schema.ts   (the Feature_Names, Layouts and tables)
//   - compat-bitset.ts    (the category roles and bitsets)
//   - model-views.ts      (the read-only Views)
//   - model-codec.ts      (the Model_Codec, new design)
//   - lexicon.ts          (the Lexicon, new design)
//   - key-fold.ts         (the Fold, new design)
//   - index.ts            (public entry, new design)
// Tests, too, are new design (only the modules are ported); they are
// excluded by the `.test.ts` suffix below rather than named here.
const NEW_DESIGN_BASENAMES = new Set([
  'python-compat.ts',
  'almor-serializer.ts',
  'lfu-cache.ts',
  'string-table.ts',
  'feature-schema.ts',
  'compat-bitset.ts',
  'model-views.ts',
  'model-codec.ts',
  'lexicon.ts',
  'key-fold.ts',
  'index.ts',
]);

// The third-party inputs NOTICE must have a row for, besides the Word_Lists
// (which are discovered from fixtures/wordlists/). Each entry is a human
// label and a substring that must appear in a NOTICE heading/body.
const REQUIRED_NOTICE_INPUTS = [
  { label: 'CAMeL Tools (engine port)', needle: 'CAMeL Tools (engine port)' },
  { label: 'Camel Morph MSA v1.0 (database)', needle: 'Camel Morph MSA v1.0' },
  // The generated typed features module carries the database's ORDER and
  // DEFINE lists (CC BY 4.0), so it needs its own row under the Camel Morph
  // section.
  { label: 'Camel Morph MSA v1.0 typed features (src/msa-features.ts)', needle: '`src/msa-features.ts`' },
];

function rel(p) {
  return relative(repoRoot, p) || p;
}

// ---------------------------------------------------------------------------
// Check 1: scan_text over every Word_List.
// ---------------------------------------------------------------------------

function findPython() {
  const venvPython =
    process.platform === 'win32'
      ? join(repoRoot, 'tools', 'parity', '.venv', 'Scripts', 'python.exe')
      : join(repoRoot, 'tools', 'parity', '.venv', 'bin', 'python');
  const candidates = [venvPython];
  if (process.platform === 'win32') {
    candidates.push('py', 'python', 'python3');
  } else {
    candidates.push('python3', 'python');
  }
  for (const candidate of candidates) {
    // The venv path is a literal file; probe it with existsSync. A bare name
    // is probed by asking for its version.
    if (candidate === venvPython) {
      if (existsSync(venvPython)) {
        return venvPython;
      }
      continue;
    }
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) {
      return candidate;
    }
  }
  return undefined;
}

function listWordlists() {
  if (!existsSync(wordlistDir)) {
    return [];
  }
  return readdirSync(wordlistDir)
    .filter((name) => name.endsWith('.words.txt') || name.endsWith('.requests.jsonl'))
    .sort()
    .map((name) => join(wordlistDir, name));
}

// Returns { status: 'ok' | 'skip' | 'fail', issues: string[] }.
function checkScanText() {
  const issues = [];
  const wordlists = listWordlists();

  if (wordlists.length === 0) {
    console.log('scan_text:  no Word_Lists found under fixtures/wordlists/.');
    return { status: 'ok', issues };
  }
  if (!existsSync(scanText)) {
    console.log(
      `scan_text:  SKIPPED — ${rel(scanText)} is not present yet.`,
    );
    return { status: 'skip', issues };
  }

  const override = process.env['SHANISARF_PARITY_PYTHON'];
  if (override !== undefined && override !== '' && !existsSync(override)) {
    console.log(`scan_text:  FAIL — SHANISARF_PARITY_PYTHON names ${override}, which does not exist.`);
    issues.push(`SHANISARF_PARITY_PYTHON names ${override}, which does not exist.`);
    return { status: 'fail', issues };
  }
  const python = override !== undefined && override !== '' ? override : findPython();
  if (!python) {
    console.log(
      'scan_text:  SKIPPED — no Python 3 interpreter found (looked for the ' +
        'parity venv and a system python3). Install Python or build the ' +
        'parity venv (`npm run parity:setup`) to run this guard.',
    );
    return { status: 'skip', issues };
  }

  // scan_text.py takes the Word_List paths as argv; it exits 0 when clean, 1
  // on violations (printed to stderr), 2 on usage/missing-file. It edits
  // nothing. We inherit stdio so its own report reaches the user verbatim.
  const result = spawnSync(python, [scanText, ...wordlists], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  if (result.error) {
    console.log(
      `scan_text:  SKIPPED — could not run ${rel(scanText)}: ${result.error.message}`,
    );
    return { status: 'skip', issues };
  }
  if (result.status === 0) {
    console.log(
      `scan_text:  OK — ${wordlists.length} list(s) passed the text guard.`,
    );
    return { status: 'ok', issues };
  }
  // Any non-zero status is a reportable failure of this guard.
  issues.push(
    `scan_text reported violations (exit ${result.status}); see its output above.`,
  );
  return { status: 'fail', issues };
}

// ---------------------------------------------------------------------------
// Check 2: NOTICE has a row for every Word_List, Request_List and third-party input.
// ---------------------------------------------------------------------------

function checkNoticeRows() {
  const issues = [];

  if (!existsSync(noticePath)) {
    issues.push(`NOTICE file not found at ${rel(noticePath)}.`);
    console.log('notice-rows: FAIL — NOTICE file is missing.');
    return { status: 'fail', issues };
  }

  const notice = readFileSync(noticePath, 'utf8');
  // Collect the "### <name>" headings; a Word_List row is "### <name> (...)".
  const headings = [];
  for (const line of notice.split('\n')) {
    const match = /^###\s+(.+?)\s*$/.exec(line);
    if (match) {
      headings.push(match[1]);
    }
  }
  const headingText = headings.join('\n');

  // Every committed Word_List and Request_List must have a row. The heading
  // convention is "### <name> (parity word list)" or "### <name> (parity
  // request list)"; we match on the list's base name (the file is
  // "<name>.words.txt" or "<name>.requests.jsonl").
  for (const path of listWordlists()) {
    const base = path.split('/').pop() ?? '';
    const name = base.replace(/\.(words\.txt|requests\.jsonl)$/u, '');
    const hasRow = headings.some((h) => h.startsWith(`${name} `) || h === name);
    if (!hasRow) {
      issues.push(
        `NOTICE has no row for the list "${name}" ` +
          `(fixtures/wordlists/${base}); add a "### ${name} ..." row before it lands.`,
      );
    }
  }

  // Every named third-party input must have a row.
  for (const input of REQUIRED_NOTICE_INPUTS) {
    if (!headingText.includes(input.needle)) {
      issues.push(
        `NOTICE has no row for the third-party input "${input.label}".`,
      );
    }
  }

  if (issues.length === 0) {
    console.log(
      'notice-rows: OK — every Word_List, Request_List and third-party input has a NOTICE row.',
    );
    return { status: 'ok', issues };
  }
  console.log('notice-rows: FAIL — missing NOTICE rows:');
  for (const issue of issues) {
    console.log(`  - ${issue}`);
  }
  return { status: 'fail', issues };
}

// ---------------------------------------------------------------------------
// Check 3: ported .ts files that lack the ported-code notice.
// ---------------------------------------------------------------------------

function listEngineTsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listEngineTsFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

// A file is expected to carry the ported-code notice unless it is new design.
// New design is: a `.test.ts` file (tests are new design), or one of the
// named new-design modules. Generated charmaps/<name>.ts carry the notice
// from their generator, so they ARE expected to have it and are not excluded
// here.
function isNewDesign(path) {
  const base = path.split('/').pop() ?? '';
  if (base.endsWith('.test.ts')) {
    return true;
  }
  return NEW_DESIGN_BASENAMES.has(base);
}

function checkPortedNotice() {
  const issues = [];
  if (!existsSync(engineDir)) {
    console.log('ported-notice: no src/engine/ directory; nothing to check.');
    return { status: 'ok', issues };
  }

  const lacksNotice = (path) => !readFileSync(path, 'utf8').includes(PORTED_NOTICE_MARKER);
  const ported = listEngineTsFiles(engineDir)
    .filter((path) => !isNewDesign(path))
    .sort();
  const missing = ported.filter(lacksNotice);

  // src/worker/ is new design throughout (CAMeL Tools has no worker): a file
  // there carrying the notice would mean ported code moved in, and this check
  // would need to say so.
  const workerPorted = existsSync(workerDir)
    ? listEngineTsFiles(workerDir).filter((path) => !lacksNotice(path)).sort()
    : [];
  if (workerPorted.length > 0) {
    console.log('ported-notice: NOTE — files under src/worker/ carry the ported-code notice, but src/worker/ is new design:');
    for (const path of workerPorted) console.log(`  - ${rel(path)}`);
  }
  // src/align/ is new design throughout too: the same note.
  const alignPorted = existsSync(alignDir)
    ? listEngineTsFiles(alignDir).filter((path) => !lacksNotice(path)).sort()
    : [];
  if (alignPorted.length > 0) {
    console.log('ported-notice: NOTE — files under src/align/ carry the ported-code notice, but src/align/ is new design:');
    for (const path of alignPorted) console.log(`  - ${rel(path)}`);
  }

  if (missing.length === 0) {
    console.log(
      `ported-notice: OK — all ${ported.length} ported file(s) under ` +
        'src/engine/ carry the ported-code notice' +
        (workerPorted.length + alignPorted.length === 0 ? '; src/worker/ and src/align/ hold no ported file.' : '.'),
    );
    return { status: 'ok', issues };
  }
  console.log('ported-notice: FAIL — ported files missing the notice:');
  for (const path of missing) {
    const line = `  - ${rel(path)}`;
    console.log(line);
    issues.push(`${rel(path)} lacks the ported-code notice.`);
  }
  return { status: 'fail', issues };
}

// ---------------------------------------------------------------------------
// Check 4: no network API in the library's code, `fetch` only in the loader.
// ---------------------------------------------------------------------------

const NETWORK_APIS = [
  ['fetch', /\bfetch\s*\(/u],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/u],
  ['WebSocket', /\bWebSocket\b/u],
  ['EventSource', /\bEventSource\b/u],
  ['sendBeacon', /\bsendBeacon\b/u],
  ['importScripts', /\bimportScripts\s*\(/u],
  ['dynamic import()', /\bimport\s*\(/u],
  ['a node: network module', /['"]node:(?:http|https|http2|net|tls|dgram)['"]/u],
];

/** The only files that may call `fetch`: the loader's two read modules. */
const FETCH_ALLOWED = new Set([join('src', 'load', 'read-asset.ts'), join('src', 'load', 'read-asset-node.ts')]);

/** `text` with its comments blanked, line breaks kept so line numbers hold. */
function withoutComments(text) {
  return text
    .replace(/\/\*[^]*?\*\//gu, (block) => block.replace(/[^\n]/gu, ' '))
    .replace(/\/\/[^\n]*/gu, '');
}

function checkNoNetwork() {
  const issues = [];
  let fetches = 0;
  const srcDir = join(repoRoot, 'src');
  const files = existsSync(srcDir)
    ? listEngineTsFiles(srcDir).filter((path) => !path.endsWith('.test.ts') && !path.endsWith('.d.ts'))
    : [];
  for (const path of files.sort()) {
    const lines = withoutComments(readFileSync(path, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      for (const [name, pattern] of NETWORK_APIS) {
        if (!pattern.test(line)) continue;
        if (name === 'fetch' && FETCH_ALLOWED.has(rel(path))) {
          fetches++;
          continue;
        }
        issues.push(`${rel(path)}:${i + 1} uses ${name}.`);
      }
    });
  }
  if (issues.length === 0) {
    console.log(
      `no-network: OK — no network API in ${files.length} file(s) under src/; ` +
        `fetch only in the loader's two read modules (${fetches} call(s)).`,
    );
    return { status: 'ok', issues };
  }
  console.log('no-network: FAIL — network APIs outside the loader\'s read modules:');
  for (const issue of issues) {
    console.log(`  - ${issue}`);
  }
  return { status: 'fail', issues };
}

// ---------------------------------------------------------------------------
// Check 5: the data package directory and the loader's and packages' names.
// ---------------------------------------------------------------------------

/** Runs of whitespace as one space, as NOTICE wraps and indents. */
const squash = (text) => text.replace(/[ \t\r\n]+/gu, ' ').trim();

/** A labeled field (`- Label: …`) of the root NOTICE's Camel Morph MSA section, squashed. */
function noticeField(notice, label) {
  const section = notice.slice(notice.indexOf('### Camel Morph MSA v1.0'), notice.indexOf('## Fixture word lists'));
  const at = section.indexOf(`- ${label}: `);
  if (at === -1) return null;
  const rest = section.slice(at + label.length + 4);
  const end = rest.search(/\n- |\n\n|\n##/u);
  return squash(end === -1 ? rest : rest.slice(0, end));
}

/** Files under `dir` that git would commit: tracked, or untracked and not ignored. */
function committable(dir) {
  const r = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', dir], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (r.status !== 0) return null;
  return r.stdout.split('\0').filter((f) => f !== '' && existsSync(join(repoRoot, f)));
}

/** Every file name (not path) under `dir`, recursively. */
function fileNames(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? [entry.name, ...fileNames(join(dir, entry.name))] : [entry.name],
  );
}

/** The names an entry module exports (`export { a, type B as C }` lists and declarations). */
function exportNames(path) {
  if (!existsSync(path)) return [];
  const text = withoutComments(readFileSync(path, 'utf8'));
  const names = [];
  for (const m of text.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/gu)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/u, '').split(/\s+as\s+/u).pop();
      if (name) names.push(name);
    }
  }
  for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|interface|type)\s+([A-Za-z_$][\w$]*)/gu)) {
    names.push(m[1]);
  }
  return names;
}

function checkDataPackage() {
  const issues = [];
  const notes = [];
  const pkgDir = join(repoRoot, 'packages', 'shanisarf-db-msa');
  if (!existsSync(pkgDir)) {
    console.log('data-package: SKIPPED — packages/shanisarf-db-msa/ does not exist yet.');
    return { status: 'ok', issues };
  }
  const notice = readFileSync(join(repoRoot, 'NOTICE'), 'utf8');
  const credits = noticeField(notice, 'Attribution text')?.replace(/^"|"$/gu, '') ?? null;
  const citation = noticeField(notice, 'Citation');
  const pinSha = /SHA-256\s+`([0-9a-f]{64})`/u.exec(notice)?.[1] ?? null;
  const pinBytes = Number(/\(([\d,]+) bytes\)/u.exec(notice)?.[1]?.replaceAll(',', '') ?? NaN);
  if (credits === null || citation === null || pinSha === null || !Number.isFinite(pinBytes)) {
    issues.push('the root NOTICE has no Camel Morph MSA attribution text, citation, SHA-256 or size to compare against.');
  } else {
    // The attribution and citation, in source.json and the package NOTICE.
    let record = null;
    try {
      record = JSON.parse(readFileSync(join(pkgDir, 'source.json'), 'utf8'));
    } catch (e) {
      issues.push(`packages/shanisarf-db-msa/source.json is missing or not JSON (${e.message}).`);
    }
    if (record !== null) {
      if (squash(String(record.credits ?? '')) !== credits) issues.push('source.json credits differ from the root NOTICE attribution text.');
      if (squash(String(record.citation ?? '')) !== citation) issues.push('source.json citation differs from the root NOTICE citation.');
    }
    const pkgNotice = existsSync(join(pkgDir, 'NOTICE')) ? squash(readFileSync(join(pkgDir, 'NOTICE'), 'utf8')) : '';
    if (!pkgNotice.includes(credits)) issues.push('packages/shanisarf-db-msa/NOTICE lacks the root NOTICE attribution text.');
    if (!pkgNotice.includes(citation)) issues.push('packages/shanisarf-db-msa/NOTICE lacks the root NOTICE citation.');

    // The raw database never ships.
    const files = committable('packages');
    if (files === null) {
      issues.push('git ls-files failed: cannot list the files under packages/.');
    } else {
      for (const file of files) {
        const path = join(repoRoot, file);
        if (statSync(path).size === pinBytes || createHash('sha256').update(readFileSync(path)).digest('hex') === pinSha) {
          issues.push(`${file} has the Database_Pin's size or SHA-256.`);
        }
      }
    }
  }

  // Upstream names: none in the packages, the loader, the compiler or the
  // demo.
  const brand = /camel|calima/iu;
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const rootJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const named = [
    ...[pkgJson.name, rootJson.name].map((n) => [`package name ${n}`, n]),
    ...Object.keys(pkgJson.exports ?? {}).map((k) => [`exports key ${k} (data package)`, k]),
    ...Object.keys(rootJson.exports ?? {}).map((k) => [`exports key ${k}`, k]),
    ...['src/index.ts', 'src/index-node.ts', 'src/load/index.ts', 'src/load/index-node.ts', 'src/compile/index.ts'].flatMap((f) =>
      exportNames(join(repoRoot, f)).map((n) => [`export ${n} (${f})`, n]),
    ),
    ...['src/load', 'src/compile', 'packages', 'demo'].flatMap((d) =>
      fileNames(join(repoRoot, d)).map((n) => [`file ${d}/…/${n}`, n]),
    ),
    ...['compile-db.mjs', 'parity-asset.mjs', 'demo-server.mjs'].map((n) => [`file scripts/${n}`, n]),
  ];
  for (const [what, name] of named) {
    if (brand.test(String(name))) issues.push(`${what} contains an upstream name (camel or calima).`);
  }

  // src/load/ and src/compile/ are new design.
  for (const dir of ['src/load', 'src/compile']) {
    const abs = join(repoRoot, dir);
    const tsFiles = existsSync(abs) ? listEngineTsFiles(abs) : [];
    for (const path of tsFiles) {
      if (readFileSync(path, 'utf8').includes(PORTED_NOTICE_MARKER)) {
        notes.push(`${rel(path)} carries the ported-code notice, but ${dir}/ is new design.`);
      }
    }
  }

  for (const note of notes) console.log(`data-package: NOTE — ${note}`);
  if (issues.length === 0) {
    console.log(
      `data-package: OK — the attribution and citation match the root NOTICE; no file under packages/ is the raw database; ` +
        `no upstream name in ${named.length} package, export or file name(s).`,
    );
    return { status: 'ok', issues };
  }
  console.log('data-package: FAIL —');
  for (const issue of issues) console.log(`  - ${issue}`);
  return { status: 'fail', issues };
}

// ---------------------------------------------------------------------------
// Driver.
// ---------------------------------------------------------------------------

function main() {
  console.log('shanisarf invariant check (report-only; edits nothing)\n');

  const results = [checkScanText(), checkNoticeRows(), checkPortedNotice(), checkNoNetwork(), checkDataPackage()];

  const failed = results.filter((r) => r.status === 'fail');
  const totalIssues = results.reduce((n, r) => n + r.issues.length, 0);

  console.log('');
  if (failed.length === 0) {
    console.log('check:invariants — all checks passed (report-only).');
    process.exit(0);
  }
  console.log(
    `check:invariants — ${totalIssues} issue(s) reported across ` +
      `${failed.length} check(s). This report edits nothing; fix the sources ` +
      'and re-run.',
  );
  process.exit(1);
}

main();
