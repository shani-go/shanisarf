// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The demo's one-origin server. It serves, from 127.0.0.1 only:
//
//   /          demo/ (index.html, demo.js, demo.css)
//   /dist/     the built package (dist/), whose worker web entry the page loads
//   /asset/    the data package's compiled Asset (packages/shanisarf-db-msa/asset/)
//
// Every response carries the Content-Security-Policy `default-src 'self';
// script-src 'self'; worker-src 'self'; connect-src 'self'; style-src
// 'self'; img-src 'self'`, which the page repeats in a <meta>, so the
// browser itself refuses any other origin. When it serves index.html it
// writes the Asset_Digest from asset-digest.json into the `<html>` element's
// `data-manifest-sha256` attribute, which demo.js reads: no extra route and
// no inline script. It logs every request, and exits with a notice when
// dist/ or the Asset is missing.
//
// This is a new-design developer script: project header only, no ported-code
// notice.
//
// Usage:
//   npm run build
//   npm run compile:db
//   npm run demo                      # http://127.0.0.1:8040/
//   npm run demo -- --port 9000

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = join(repoRoot, 'demo');
const distDir = join(repoRoot, 'dist');
const pkgDir = join(repoRoot, 'packages', 'shanisarf-db-msa');
const assetDir = join(pkgDir, 'asset');

const CSP =
  "default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self'";
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.bin': 'application/octet-stream',
};

const portAt = process.argv.indexOf('--port');
const port = portAt === -1 ? 8040 : Number(process.argv[portAt + 1]);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('\ndemo — --port needs a port number.\n');
  process.exit(2);
}

const missing = [];
if (!existsSync(join(distDir, 'esm', 'worker', 'web.js'))) missing.push(['the built package', 'npm run build']);
if (!existsSync(join(assetDir, 'manifest.json'))) missing.push(['the compiled Asset', 'npm run compile:db']);
if (missing.length > 0) {
  console.error(
    [
      '',
      'demo — not started: these are missing:',
      '',
      ...missing.map(([what, fix]) => `  ${what}: run \`${fix}\``),
      '',
      'The Asset needs the Database_Pin in data/ (`npm run parity:setup` fetches it).',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const digest = JSON.parse(readFileSync(join(pkgDir, 'asset-digest.json'), 'utf8')).assetDigest;

/** The file under `root` that `rest` names, or null when it would leave `root`. */
function under(root, rest) {
  const file = normalize(join(root, rest));
  return file === root || file.startsWith(root + sep) ? file : null;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = decodeURIComponent(url.pathname);
  res.setHeader('content-security-policy', CSP);
  res.setHeader('x-content-type-options', 'nosniff');
  const done = (status) => console.log(`${new Date().toISOString()} ${req.method} ${path} ${status}`);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return done(405);
  }
  let file = null;
  if (path === '/' || path === '/index.html') {
    const html = readFileSync(join(demoDir, 'index.html'), 'utf8').replace(
      'data-manifest-sha256=""',
      `data-manifest-sha256="${digest}"`,
    );
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : html);
    return done(200);
  }
  if (path.startsWith('/dist/')) file = under(distDir, path.slice('/dist/'.length));
  else if (path.startsWith('/asset/')) file = under(assetDir, path.slice('/asset/'.length));
  else file = under(demoDir, path.slice(1));

  if (file === null || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return done(404);
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
  } else {
    createReadStream(file).pipe(res);
  }
  return done(200);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`demo — serving demo/, dist/ and the Asset on http://127.0.0.1:${server.address().port}/`);
  console.log(`demo — the page pins the Asset_Digest ${digest} (asset-digest.json).`);
  const manifest = join(assetDir, 'manifest.json');
  if (createHash('sha256').update(readFileSync(manifest)).digest('hex') !== digest) {
    console.log('demo — WARNING: the Asset is not the expected one; the page will refuse it. Run `npm run compile:db`.');
  }
  console.log('demo — every request is logged below.\n');
});
