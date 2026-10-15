// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// A worker opened from an Asset is the in-thread analyzer. Runs the package as
// built, compiled with tsconfig.esm.json into a private temporary directory
// (so it never races another test's build), with the worker as the built
// `entry-node.js` under `worker_threads`. Over the Database_Pin compiled to an
// Asset: analyses under each backoff mode (flags `a`), generation and
// reinflection (flags `r`), and `provenance` agree with the in-thread engine
// over the parsed pin. Over a hand-made Asset, which needs no pin, a changed
// Shard byte rejects creation with `AssetIntegrityError` as its own class. The
// pin cases skip with the replay notice when data/ lacks the pin.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_PATH, databaseAvailable, SETUP_HINT } from '../parity/replay-support';
import { MINI_DB } from '../support/generation-mini-db.js';

import { loadRequestList, loadWordlistWords } from './wordlists';

type Engine = typeof import('../../src/index-node.js');
type Compiler = typeof import('../../src/compile/index.js');
type WorkerEntry = typeof import('../../src/worker/node-import.js');
type MorphologyDb = InstanceType<Engine['MorphologyDb']>;
type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

let work: string;
let engine: Engine;
let compiler: Compiler;
let entry: WorkerEntry;

/** Compile the sources as the ESM build does, into a private directory, and load the built modules. */
async function buildAndLoad(): Promise<void> {
  work = mkdtempSync(join(tmpdir(), 'shanisarf-property9-'));
  const built = spawnSync(
    process.execPath,
    [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(ROOT, 'tsconfig.esm.json'), '--outDir', join(work, 'esm')],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (built.status !== 0) {
    throw new Error(`the ESM build failed:\n${built.stdout}\n${built.stderr}`);
  }
  const load = async (path: string): Promise<unknown> => import(pathToFileURL(join(work, 'esm', path)).href);
  engine = (await load('index-node.js')) as Engine;
  compiler = (await load('compile/index.js')) as Compiler;
  entry = (await load('worker/node-import.js')) as WorkerEntry;
}

/** Compile `bytes` with a Source_Record made for them into `dir`; the Asset_Digest. */
async function compileInto(dir: string, bytes: Uint8Array, id: string): Promise<string> {
  const asset = await compiler.compileDatabase(bytes, {
    id,
    name: id,
    version: '0.0',
    source: `https://example.invalid/${id}.db`,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    sourceBytes: bytes.length,
    license: { id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    credits: 'Compiled by a property test.',
    disclaimer: 'No warranty.',
    citation: 'None.',
  });
  await compiler.writeAsset(dir, asset);
  return asset.assetDigest;
}

function outcomeOf(call: () => unknown): Outcome {
  try {
    return { ok: true, value: call() };
  } catch (error) {
    return { ok: false, error };
  }
}

async function settle(promise: Promise<unknown>): Promise<Outcome> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

function sameEntries(a: object, b: object): boolean {
  const ea = Object.entries(a);
  const eb = Object.entries(b);
  return ea.length === eb.length && ea.every(([k, v], i) => k === eb[i]?.[0] && Object.is(v, eb[i]?.[1]));
}

/** The first way two result lists differ, or null. */
function resultsDiffer(a: unknown, b: unknown): string | null {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return sameEntries(Object(a), Object(b)) ? null : `${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  if (a.length !== b.length) {
    return `${a.length} results vs ${b.length}`;
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as { word?: unknown; analyses?: unknown };
    const y = b[i] as { word?: unknown; analyses?: unknown };
    if ('analyses' in x && 'analyses' in y) {
      const d = x.word === y.word ? resultsDiffer(x.analyses, y.analyses) : 'word';
      if (d !== null) return `word ${i}: ${d}`;
    } else if (!sameEntries(x, y)) {
      return `result ${i}: ${JSON.stringify(x).slice(0, 160)} vs ${JSON.stringify(y).slice(0, 160)}`;
    }
  }
  return null;
}

/** The first way the worker's outcome differs from the in-thread one, or null. */
function outcomesDiffer(worker: Outcome, inThread: Outcome): string | null {
  if (worker.ok && inThread.ok) {
    return resultsDiffer(worker.value, inThread.value);
  }
  if (worker.ok || inThread.ok) {
    return `the worker ${worker.ok ? 'returned' : 'threw'}, in thread it ${inThread.ok ? 'returned' : 'threw'}`;
  }
  const w = worker.error as Error;
  const t = inThread.error as Error;
  if (Object.getPrototypeOf(w) !== Object.getPrototypeOf(t)) {
    return `class ${w.constructor?.name} vs ${t.constructor?.name}`;
  }
  if (w.name !== t.name || w.message !== t.message || !sameEntries(w, t)) {
    return `${w.name}: ${w.message} vs ${t.name}: ${t.message}`;
  }
  return null;
}

describe('a worker opened from an Asset is the in-thread analyzer', () => {
  beforeAll(buildAndLoad, 300_000);
  afterAll(() => {
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  it('over a hand-made Asset: the Provenance crosses, and a changed Shard byte rejects as AssetIntegrityError', { timeout: 300_000 }, async () => {
    const dir = join(work, 'mini');
    const digest = await compileInto(dir, new TextEncoder().encode(MINI_DB), 'mini-db');
    const loaded: MorphologyDb = await engine.loadDatabase(dir, { flags: 'r' });
    const wa = await entry.createWorkerAnalyzer({ source: { asset: dir, manifestSha256: digest }, flags: 'r' });
    try {
      expect(wa.provenance).toEqual(loaded.provenance);
      expect(wa.provenance?.assetDigest).toBe(digest);
      const inThread = new engine.Analyzer(loaded);
      for (const word of ['كتاب', 'الكتاب', 'وكتبت', 'يكتب', 'كبير', 'زززز']) {
        expect(outcomesDiffer(await settle(wa.analyze(word)), outcomeOf(() => inThread.analyze(word))), word).toBeNull();
      }
    } finally {
      await wa.terminate();
    }

    // The same Asset with its stems Shard delivered inflated and one byte changed.
    const changed = join(work, 'mini-changed');
    cpSync(dir, changed, { recursive: true });
    const content = new Uint8Array(inflateSync(readFileSync(join(changed, 'stems.bin'))));
    content[content.length - 1] = (content[content.length - 1] as number) ^ 1;
    writeFileSync(join(changed, 'stems.bin'), content);
    const manifest = JSON.parse(readFileSync(join(changed, 'manifest.json'), 'utf8')) as { shards: { part: string; sha256: string }[] };
    const error = (await entry.createWorkerAnalyzer({ source: { asset: changed }, flags: 'r' }).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(engine.AssetIntegrityError);
    expect(error).toBeInstanceOf(engine.DatabaseError);
    expect(error).toMatchObject({
      name: 'AssetIntegrityError',
      path: 'stems.bin',
      expected: manifest.shards.find((s) => s.part === 'stems')?.sha256,
      actual: createHash('sha256').update(content).digest('hex'),
    });
  });

  if (!databaseAvailable()) {
    it.skip(`over the pin is skipped: the Database_Pin is absent — run \`${SETUP_HINT}\``, () => {
      /* skipped — data/ lacks the Database_Pin */
    });
    return;
  }

  describe('over the pin', () => {
    let dir: string;
    let digest: string;
    let text: string;
    let words: string[];
    beforeAll(async () => {
      dir = join(work, 'pin');
      const bytes = readFileSync(DB_PATH);
      digest = await compileInto(dir, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), 'camel-morph-msa');
      text = bytes.toString('utf8');
      words = [
        ...loadWordlistWords('edge-cases'),
        ...loadWordlistWords('db-forms'),
        ...loadWordlistWords('backoff-nonwords'),
      ];
    }, 300_000);

    for (const backoff of ['NONE', 'NOAN_ALL', 'NOAN_PROP', 'ADD_ALL', 'ADD_PROP'] as const) {
      it(`analyze and analyzeWords from the Asset agree with in thread, backoff ${backoff}`, { timeout: 300_000 }, async () => {
        const parsed = engine.parseAlmor(text, { flags: 'a' });
        const wa = await entry.createWorkerAnalyzer({
          source: { asset: dir, manifestSha256: digest },
          flags: 'a',
          analyzer: { backoff },
        });
        try {
          expect(wa.provenance).toEqual((await engine.loadDatabase(dir)).provenance);
          const inThread = new engine.Analyzer(parsed, { backoff });
          await fc.assert(
            fc.asyncProperty(fc.array(fc.constantFrom(...words), { minLength: 1, maxLength: 20 }), async (batch) => {
              const diffs: string[] = [];
              const batchDiff = outcomesDiffer(await settle(wa.analyzeWords(batch)), outcomeOf(() => inThread.analyzeWords(batch)));
              if (batchDiff !== null) diffs.push(`analyzeWords: ${batchDiff}`);
              const each = await Promise.all(batch.map((w) => settle(wa.analyze(w))));
              each.forEach((outcome, i) => {
                const w = batch[i] as string;
                const d = outcomesDiffer(outcome, outcomeOf(() => inThread.analyze(w)));
                if (d !== null) diffs.push(`analyze ${JSON.stringify(w)}: ${d}`);
              });
              expect(diffs).toEqual([]);
            }),
            { numRuns: 20 },
          );
        } finally {
          await wa.terminate();
        }
      });
    }

    it('generate and reinflect from the Asset over Request_List samples agree with in thread', { timeout: 300_000 }, async () => {
      const dbR = engine.parseAlmor(text, { flags: 'r' });
      const generator = new engine.Generator(dbR);
      const reinflector = new engine.Reinflector(dbR);
      const genRequests = loadRequestList('gen-requests');
      const reinflectRequests = loadRequestList('reinflect-requests');
      const wa = await entry.createWorkerAnalyzer({ source: { asset: dir, manifestSha256: digest }, flags: 'r' });
      try {
        expect(wa.provenance).toEqual((await engine.loadDatabase(dir, { flags: 'r' })).provenance);
        await fc.assert(
          fc.asyncProperty(
            fc.array(fc.constantFrom(...genRequests), { minLength: 1, maxLength: 10 }),
            fc.array(fc.constantFrom(...reinflectRequests), { minLength: 1, maxLength: 10 }),
            async (gens, reinfls) => {
              const calls: [string, Promise<unknown>, () => unknown][] = [
                ...gens.map(
                  (q) =>
                    [
                      `generate ${JSON.stringify(q)}`,
                      wa.generate(q.lemma as string, q.feats),
                      () => generator.generate(q.lemma as string, q.feats),
                    ] as [string, Promise<unknown>, () => unknown],
                ),
                ...reinfls.map(
                  (q) =>
                    [
                      `reinflect ${JSON.stringify(q)}`,
                      wa.reinflect(q.word as string, q.feats),
                      () => reinflector.reinflect(q.word as string, q.feats),
                    ] as [string, Promise<unknown>, () => unknown],
                ),
              ];
              const settled = await Promise.all(calls.map(([, promise]) => settle(promise)));
              const diffs: string[] = [];
              settled.forEach((outcome, i) => {
                const [what, , inThread] = calls[i] as [string, Promise<unknown>, () => unknown];
                const d = outcomesDiffer(outcome, outcomeOf(inThread));
                if (d !== null) diffs.push(`${what}: ${d}`);
              });
              expect(diffs).toEqual([]);
            },
          ),
          { numRuns: 20 },
        );
      } finally {
        await wa.terminate();
      }
    });
  });
});
