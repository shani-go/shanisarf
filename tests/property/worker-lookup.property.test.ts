// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// A worker lookup is the in-thread lookup. Runs the package as built,
// compiled with tsconfig.esm.json into a private temporary directory, so the
// worker is the built `entry-node.js` under `worker_threads`. For any
// `lexiconDoc` text under `a` or `r`, a Worker_Analyzer and an in-thread
// `Lexicon` agree for every Lookup_Key and key (exact, folded, and with a
// `features` subset), the lookups sent at once; a bad `by` or non-string key
// rejects with the Lexicon's `TypeError`. Over the Database_Pin (skipped
// without data/), sampled lemmas, stems and roots agree, and the host keeps
// its Lexicon: later folded lemma lookups take under a fifth of the first.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_PATH, databaseAvailable, SETUP_HINT } from '../parity/replay-support';

import { LOOKUP_KEYS, keyOf, lexiconDoc } from './lexicon-support';

type Engine = typeof import('../../src/index-node.js');
type WorkerEntry = typeof import('../../src/worker/node-import.js');
type Lexicon = InstanceType<Engine['Lexicon']>;
type LookupKey = 'lemma' | 'stem' | 'root';
type LookupOptions = { fold?: boolean; features?: readonly string[] };
type WorkerAnalyzer = Awaited<ReturnType<WorkerEntry['createWorkerAnalyzer']>>;

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

let work: string | undefined;
let engine: Engine;
let entry: WorkerEntry;

/** Compile the sources as the ESM build does, into a private directory, and load the built modules. */
async function buildAndLoad(): Promise<void> {
  work = mkdtempSync(join(tmpdir(), 'shanisarf-consumer6-'));
  const built = spawnSync(
    process.execPath,
    [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(ROOT, 'tsconfig.esm.json'), '--outDir', join(work, 'esm')],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (built.status !== 0) {
    throw new Error(`the ESM build failed:\n${built.stdout}\n${built.stderr}`);
  }
  const load = async (path: string): Promise<unknown> => import(pathToFileURL(join(work as string, 'esm', path)).href);
  engine = (await load('index-node.js')) as Engine;
  entry = (await load('worker/node-import.js')) as WorkerEntry;
}

/** The first way two record lists differ by `Object.entries` at each index, or null. */
function recordsDiffer(got: unknown, want: readonly object[]): string | null {
  if (!Array.isArray(got)) return `the worker returned ${typeof got}`;
  if (got.length !== want.length) return `${got.length} records vs ${want.length}`;
  for (let i = 0; i < want.length; i++) {
    const g = Object.entries(got[i] as object);
    const w = Object.entries(want[i] as object);
    const same =
      g.length === w.length &&
      g.every(([k, v], j) => {
        const [wk, wv] = w[j] as [string, unknown];
        if (k !== wk) return false;
        if (k === 'features') return JSON.stringify(Object.entries(v as object)) === JSON.stringify(Object.entries(wv as object));
        return Object.is(v, wv);
      });
    if (!same) return `record ${i}: ${JSON.stringify(got[i])} vs ${JSON.stringify(want[i])}`;
  }
  return null;
}

/** What an in-thread lookup throws, or null. */
function thrownBy(call: () => unknown): Error | null {
  try {
    call();
  } catch (e) {
    return e as Error;
  }
  return null;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  return null;
}

/** Every key the in-thread Lexicon's entries hold under any Lookup_Key, their folded forms, and absent ones. */
function probeKeys(lexicon: Lexicon): string[] {
  const keys = new Set<string>(['', 'zz', 'غغ']);
  for (const r of lexicon.entries()) {
    for (const by of LOOKUP_KEYS) {
      const k = keyOf(by, r);
      if (k !== undefined) {
        keys.add(k);
        keys.add(engine.foldArabicKey(k));
      }
    }
  }
  return [...keys];
}

const FEATURE_NAMES = ['diac', 'lex', 'pos', 'gen', 'bw', 'root', 'nothing'];

const badBy: fc.Arbitrary<unknown> = fc.oneof(
  fc.string({ maxLength: 6 }).filter((s) => !(LOOKUP_KEYS as readonly string[]).includes(s)),
  fc.constantFrom('Lemma', 'lex', 'surface', 'roots'),
  fc.integer(),
  fc.constantFrom(null, undefined),
  fc.constant({ by: 'lemma' }),
);
const badKey: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer(),
  fc.constantFrom(null, undefined, true, false),
  fc.array(fc.constantFrom('ب', 'ا'), { maxLength: 2 }),
  fc.constant({ key: 'ب' }),
);

/** Each lookup through the worker, sent at once, against the in-thread Lexicon; the failures. */
async function compareLookups(
  wa: WorkerAnalyzer,
  lexicon: Lexicon,
  probes: readonly [LookupKey, string, LookupOptions | undefined][],
): Promise<{ failures: string[]; found: number }> {
  const replies = probes.map(([by, key, options]) => wa.lookup(by, key, options));
  const failures: string[] = [];
  let found = 0;
  for (let i = 0; i < probes.length; i++) {
    const [by, key, options] = probes[i] as [LookupKey, string, LookupOptions | undefined];
    const want = lexicon.lookup(by, key, options);
    if (want.length > 0) found++;
    const d = recordsDiffer(await (replies[i] as Promise<unknown>), want);
    if (d !== null) failures.push(`${by} ${JSON.stringify(key)} ${JSON.stringify(options)}: ${d}`);
  }
  return { failures, found };
}

describe('a worker lookup is the in-thread lookup', () => {
  beforeAll(buildAndLoad, 300_000);
  afterAll(() => {
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  });

  it('agrees with the in-thread Lexicon for every Lookup_Key, key and options, and rejects bad arguments with TypeError', { timeout: 120_000 }, async () => {
    let found = 0;
    await fc.assert(
      fc.asyncProperty(
        lexiconDoc,
        fc.constantFrom('a', 'r'),
        fc.shuffledSubarray(FEATURE_NAMES),
        fc.array(fc.tuple(badBy, fc.constantFrom<LookupKey>('lemma', 'stem', 'root'), badKey), { minLength: 1, maxLength: 4 }),
        async (text, flags, features, bad) => {
          const lexicon = new engine.Lexicon(engine.parseAlmor(text, { flags }));
          const wa = await entry.createWorkerAnalyzer({ source: text, flags });
          try {
            const options: (LookupOptions | undefined)[] = [undefined, { fold: true }, { features }, { fold: true, features }];
            const probes: [LookupKey, string, LookupOptions | undefined][] = [];
            for (const by of LOOKUP_KEYS) {
              for (const key of probeKeys(lexicon)) {
                for (const o of options) probes.push([by, key, o]);
              }
            }
            const result = await compareLookups(wa, lexicon, probes);
            expect(result.failures).toEqual([]);
            found += result.found;

            // A bad `by` with a good key, and a good `by` with a bad key.
            for (const [by, goodBy, key] of bad) {
              for (const [b, k] of [
                [by, 'ب'],
                [goodBy, key],
              ] as [unknown, unknown][]) {
                const want = thrownBy(() => lexicon.lookup(b as LookupKey, k as string));
                const got = await rejection(wa.lookup(b as LookupKey, k as string));
                expect(want).toBeInstanceOf(TypeError);
                expect(got).toBeInstanceOf(TypeError);
                expect(Object.getPrototypeOf(got)).toBe(TypeError.prototype);
                expect((got as Error).message).toBe((want as Error).message);
              }
            }
          } finally {
            await wa.terminate();
          }
        },
      ),
      { numRuns: 50 },
    );
    // The runs found records, not only empty lists.
    expect(found).toBeGreaterThan(0);
  });

  if (!databaseAvailable()) {
    it.skip(`over the pin is skipped: the Database_Pin is absent — run \`${SETUP_HINT}\``, () => {
      /* skipped — data/ lacks the Database_Pin */
    });
    return;
  }

  it('over the pin: ten lemmas, ten stems and ten roots agree, and the host keeps its Lexicon', { timeout: 300_000 }, async () => {
    const bytes = readFileSync(DB_PATH);
    const lexicon = new engine.Lexicon(engine.parseAlmor(bytes.toString('utf8'), { flags: 'a' }));
    const wa = await entry.createWorkerAnalyzer({ source: new Uint8Array(bytes), flags: 'a' });
    try {
      // The first folded lemma lookup builds the indexes; later ones reuse them.
      const all = [...lexicon.entries({ features: ['lex', 'root'] })];
      const lemmaAt = (i: number): string => (all[Math.floor(((i + 0.5) * all.length) / 10)] as { features: Record<string, string> }).features.lex as string;
      const time = async (key: string): Promise<number> => {
        const start = performance.now();
        await wa.lookup('lemma', key, { fold: true });
        return performance.now() - start;
      };
      const first = await time(lemmaAt(0));
      const later: number[] = [];
      for (let i = 1; i < 10; i++) later.push(await time(lemmaAt(i)));
      later.sort((x, y) => x - y);
      const median = later[4] as number;
      expect(median, `first ${first.toFixed(1)} ms, later median ${median.toFixed(1)} ms`).toBeLessThan(first / 5);

      // Ten keys of each Lookup_Key, spread over the stem table.
      const keys: [LookupKey, string][] = [];
      for (const by of LOOKUP_KEYS) {
        const held = all.filter((r) => keyOf(by, r) !== undefined);
        const picked = new Set<string>();
        const step = Math.max(1, Math.floor(held.length / 40));
        for (let i = step >> 1; picked.size < 10 && i < held.length; i += step) {
          picked.add(keyOf(by, held[i] as (typeof held)[number]) as string);
        }
        expect(picked.size).toBe(10);
        for (const k of picked) keys.push([by, k]);
      }
      const subset = ['gloss', 'pos'];
      const probes: [LookupKey, string, LookupOptions | undefined][] = [];
      for (const [by, key] of keys) {
        for (const o of [undefined, { fold: true }, { features: subset }, { fold: true, features: subset }]) probes.push([by, key, o]);
      }
      const result = await compareLookups(wa, lexicon, probes);
      expect(result.failures).toEqual([]);
      expect(result.found).toBe(probes.length);
    } finally {
      await wa.terminate();
    }
  });
});
