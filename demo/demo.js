// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The demo page's script. It creates a Worker_Analyzer through
// `shanisarf/worker`'s web entry, as built in dist/, from the compiled Asset
// this page's server serves at ./asset/, pinned to the Asset_Digest the
// server wrote into the page. The page's thread reads the Asset; the worker
// opens it and analyzes; the worker makes no request. It shows the load time
// and the Shards' sizes, the analyses of a word with the main features, the
// database's attribution from its Provenance, and any error with its class
// and message. It never retries on its own.
//
// This is a new-design file: project header only.

import { createWorkerAnalyzer } from '/dist/esm/worker/web.js';

/** The features shown for each analysis, in this order. */
const FEATURES = ['diac', 'lex', 'pos', 'root', 'pattern', 'gloss', 'bw', 'caphi', 'd3tok'];

/** The example word: a stem surface of the database the page loads. */
const EXAMPLE = 'كتاب';

const $ = (id) => document.getElementById(id);
const status = $('status');
const results = $('results');

function showError(where, error) {
  status.className = 'status error';
  status.textContent = `${where}: ${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The stored size of each Asset file this page fetched, from Resource Timing. */
function assetSizes() {
  return performance
    .getEntriesByType('resource')
    .filter((e) => new URL(e.name).pathname.startsWith('/asset/'))
    .map((e) => `${new URL(e.name).pathname.slice('/asset/'.length)} ${(e.encodedBodySize / 1e6).toFixed(2)} MB`);
}

function showAttribution(p) {
  if (p === null) return;
  $('credits').textContent = p.credits;
  $('license').textContent = p.license.id;
  $('license').href = p.license.url;
  $('disclaimer').textContent = p.disclaimer;
  $('citation').textContent = p.citation;
  $('attribution').hidden = false;
}

function showAnalyses(word, analyses) {
  results.replaceChildren();
  const heading = el('h2', '', `${analyses.length} ${analyses.length === 1 ? 'analysis' : 'analyses'} of `);
  heading.append(el('span', 'ar', word));
  results.append(heading);
  const table = el('table');
  const head = el('tr');
  head.append(el('th', '', '#'));
  for (const f of FEATURES) head.append(el('th', '', f));
  table.append(head);
  analyses.forEach((a, i) => {
    const row = el('tr');
    row.append(el('td', 'num', String(i + 1)));
    for (const f of FEATURES) {
      const value = a[f];
      const cell = el('td', ['diac', 'lex', 'd3tok'].includes(f) ? 'ar' : '', value === undefined ? '' : String(value));
      if (cell.className === 'ar') cell.dir = 'rtl';
      row.append(cell);
    }
    table.append(row);
  });
  results.append(table);
}

async function main() {
  const digest = document.documentElement.dataset.manifestSha256 || undefined;
  const started = performance.now();
  let analyzer;
  try {
    analyzer = await createWorkerAnalyzer({
      source: digest === undefined ? { asset: './asset/' } : { asset: './asset/', manifestSha256: digest },
    });
  } catch (error) {
    showError('Loading the database failed', error);
    return;
  }
  const seconds = ((performance.now() - started) / 1e3).toFixed(2);
  status.className = 'status ready';
  status.textContent = `Ready in ${seconds} s, in a worker. Downloaded: ${assetSizes().join(', ')}.${
    digest === undefined ? ' (No expected digest was given.)' : ' Verified against the expected digest.'
  }`;
  showAttribution(analyzer.provenance);

  const input = $('word');
  for (const id of ['word', 'analyze', 'example']) $(id).disabled = false;
  input.focus();

  const analyze = async (word) => {
    try {
      showAnalyses(word, await analyzer.analyze(word));
    } catch (error) {
      showError(`Analyzing ${JSON.stringify(word)} failed`, error);
    }
  };
  $('form').addEventListener('submit', (event) => {
    event.preventDefault();
    void analyze(input.value);
  });
  $('example').addEventListener('click', () => {
    input.value = EXAMPLE;
    void analyze(EXAMPLE);
  });
}

void main();
