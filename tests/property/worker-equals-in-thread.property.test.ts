// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Worker transparency. Runs the package as built (`npm run build`, then
// everything from dist/esm), so the worker is `entry-node.js` under
// `worker_threads` and the error classes on both sides are the same objects.
// Outcomes agree when results match by `Object.entries` at each index (values
// by `Object.is`), or errors by prototype, `name`, `message` and own
// enumerable fields. Over the pin, analyses (flags `a`, from text and from
// transferred bytes, each backoff mode) and generation and reinflection (flags
// `r`) agree with the in-thread engine; over `MINI_DB`, every error class
// rejects as in thread, overlapping calls each settling on their own outcome.
// The pin cases skip with the replay notice when data/ lacks the pin.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';

import { DB_PATH, databaseAvailable, SETUP_HINT } from '../parity/replay-support';
import { MINI_DB } from '../support/generation-mini-db.js';

import { loadRequestList, loadWordlistWords } from './wordlists';

type Engine = typeof import('../../src/engine/index.js');
type WorkerEntry = typeof import('../../src/worker/node-import.js');
type MorphologyDb = InstanceType<Engine['MorphologyDb']>;
type WorkerAnalyzer = Awaited<ReturnType<WorkerEntry['createWorkerAnalyzer']>>;
type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

let engine: Engine;
let entry: WorkerEntry;

/** Build the package, then load the built modules. */
async function buildAndLoad(): Promise<void> {
  const built = spawnSync('npm', ['run', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (built.status !== 0) {
    throw new Error(`npm run build failed:\n${built.stdout}\n${built.stderr}`);
  }
  const load = async (path: string): Promise<unknown> => import(pathToFileURL(`${ROOT}/dist/esm/${path}`).href);
  engine = (await load('index.js')) as Engine;
  entry = (await load('worker/node-import.js')) as WorkerEntry;
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
    return `${w.name}: ${w.message} ${JSON.stringify(Object.entries(w))} vs ${t.name}: ${t.message} ${JSON.stringify(Object.entries(t))}`;
  }
  return null;
}

describe('worker transparency', () => {
  beforeAll(buildAndLoad, 300_000);

  it('errors cross as the in-thread class, name, message and fields', { timeout: 300_000 }, async () => {
    const dbA = engine.parseAlmor(MINI_DB, { flags: 'a' });
    const dbR = engine.parseAlmor(MINI_DB, { flags: 'r' });
    const diffs: string[] = [];
    // Each case must throw in thread, so two successes cannot pass for it.
    const expectSame = async (what: string, worker: Promise<unknown>, inThread: () => unknown): Promise<void> => {
      const expected = outcomeOf(inThread);
      if (expected.ok) diffs.push(`${what}: does not throw in thread`);
      const d = outcomesDiffer(await settle(worker), expected);
      if (d !== null) diffs.push(`${what}: ${d}`);
    };

    await expectSame(
      'invalid backoff',
      entry.createWorkerAnalyzer({ source: MINI_DB, analyzer: { backoff: 'SOME' as 'NONE' } }),
      () => new engine.Analyzer(dbA, { backoff: 'SOME' as 'NONE' }),
    );
    await expectSame('invalid flag', entry.createWorkerAnalyzer({ source: MINI_DB, flags: 'q' }), () =>
      engine.parseAlmor(MINI_DB, { flags: 'q' }),
    );
    const malformed = MINI_DB.replace('DEFINE asp asp:p asp:i asp:na', 'DEFINE asp');
    await expectSame('malformed ALMOR_Text', entry.createWorkerAnalyzer({ source: malformed }), () =>
      engine.parseAlmor(malformed, { flags: 'a' }),
    );

    const r = await entry.createWorkerAnalyzer({ source: MINI_DB, flags: 'r' });
    const a = await entry.createWorkerAnalyzer({ source: new TextEncoder().encode(MINI_DB), flags: 'a' });
    try {
      const generator = new engine.Generator(dbR);
      const reinflector = new engine.Reinflector(dbR);
      for (const feats of [
        { pos: 'noun', zz: 'x' },
        { pos: 'noun', num: 'zz' },
        { num: 'p' },
      ]) {
        await expectSame(`generate ${JSON.stringify(feats)}`, r.generate('كِتاب_1', feats), () =>
          generator.generate('كِتاب_1', feats),
        );
      }
      for (const feats of [{ zz: 'x' }, { num: 'zz' }]) {
        await expectSame(`reinflect ${JSON.stringify(feats)}`, r.reinflect('كتاب', feats), () =>
          reinflector.reinflect('كتاب', feats),
        );
      }
      await expectSame('generate on an a model', a.generate('كِتاب_1', { pos: 'noun' }), () => new engine.Generator(dbA));
      await expectSame('reinflect on an a model', a.reinflect('كتاب', { num: 'p' }), () => new engine.Reinflector(dbA));

      // Overlapping calls of every kind, each on its own outcome.
      const analyzer = new engine.Analyzer(dbR);
      const calls: [string, Promise<unknown>, () => unknown][] = [
        ...['كتاب', 'الكتاب', 'وكتبت', 'يكتب', 'كبير'].map(
          (w) => [`analyze ${w}`, r.analyze(w), () => analyzer.analyze(w)] as [string, Promise<unknown>, () => unknown],
        ),
        ['analyzeWords', r.analyzeWords(['كتب', 'كتابه']), () => analyzer.analyzeWords(['كتب', 'كتابه'])],
        ['generate', r.generate('كَتَب_1', { pos: 'verb' }), () => generator.generate('كَتَب_1', { pos: 'verb' })],
        ['reinflect', r.reinflect('كتاب', { num: 'p' }), () => reinflector.reinflect('كتاب', { num: 'p' })],
        ['generate error', r.generate('كَتَب_1', { pos: 'verb', zz: 'x' }), () => generator.generate('كَتَب_1', { pos: 'verb', zz: 'x' })],
        ['allFeats', r.allFeats(), () => dbR.allFeats()],
      ];
      const settled = await Promise.all(calls.map(([, promise]) => settle(promise)));
      settled.forEach((outcome, i) => {
        const [what, , inThread] = calls[i] as [string, Promise<unknown>, () => unknown];
        const d = outcomesDiffer(outcome, outcomeOf(inThread));
        if (d !== null) diffs.push(`overlapping ${what}: ${d}`);
      });
      const feats = (await r.allFeats()) as unknown;
      expect(feats).toBeInstanceOf(Set);
    } finally {
      await r.terminate();
      await a.terminate();
    }
    expect(diffs).toEqual([]);
  });

  if (!databaseAvailable()) {
    it.skip(`over the pin is skipped: the Database_Pin is absent — run \`${SETUP_HINT}\``, () => {
      /* skipped — data/ lacks the Database_Pin */
    });
    return;
  }

  describe('over the pin', () => {
    let text: string;
    let dbA: MorphologyDb;
    let words: string[];
    beforeAll(() => {
      text = readFileSync(DB_PATH, 'utf8');
      dbA = engine.parseAlmor(text, { flags: 'a' });
      words = [
        ...loadWordlistWords('edge-cases'),
        ...loadWordlistWords('db-forms'),
        ...loadWordlistWords('backoff-nonwords'),
      ];
    }, 300_000);

    const SOURCES = ['text', 'bytes'] as const;
    for (const kind of SOURCES) {
      for (const backoff of ['NONE', 'NOAN_ALL', 'NOAN_PROP', 'ADD_ALL', 'ADD_PROP'] as const) {
        it(`analyze and analyzeWords from ${kind} agree with in thread, backoff ${backoff}`, { timeout: 300_000 }, async () => {
          const source: string | Uint8Array = kind === 'bytes' ? readFileSync(DB_PATH) : text;
          const wa: WorkerAnalyzer = await entry.createWorkerAnalyzer({
            source,
            flags: 'a',
            analyzer: { backoff },
            transfer: kind !== 'text',
          });
          try {
            if (kind === 'bytes') expect((source as Uint8Array).byteLength).toBe(0);
            const inThread = new engine.Analyzer(dbA, { backoff });
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
    }

    it('generate and reinflect over Request_List samples agree with in thread', { timeout: 300_000 }, async () => {
      const dbR = engine.parseAlmor(text, { flags: 'r' });
      const generator = new engine.Generator(dbR);
      const reinflector = new engine.Reinflector(dbR);
      const genRequests = loadRequestList('gen-requests');
      const reinflectRequests = loadRequestList('reinflect-requests');
      const wa = await entry.createWorkerAnalyzer({ source: text, flags: 'r' });
      try {
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
