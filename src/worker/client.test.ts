// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the Worker_Client, against fake workers that run the
// Worker_Host in process and pass every message through structured clone,
// transfer list included (the worker-equals-in-thread property runs the real
// worker from dist/). The database is the hand-made `MINI_DB`. Also: the Asset
// source (read on this thread through a reader function, its buffers
// transferred, opened in the worker, its Provenance on the WorkerAnalyzer, its
// errors as their own classes) and `lookup` (equal to the in-thread Lexicon, a
// `features` subset, overlapping lookups and analyses each settling on its own
// reply, a bad request rejecting with a `TypeError`, a `g` creation refused).

import { describe, expect, it } from 'vitest';

import { MINI_DB } from '../../tests/support/generation-mini-db.js';
import { parseAlmor } from '../engine/almor-parser.js';
import { Analyzer } from '../engine/analyzer.js';
import { AnalyzerError, DatabaseError, InvalidDatabaseFlagError } from '../engine/errors.js';
import { Lexicon, type LookupKey } from '../engine/lexicon.js';
import { compileDatabase, type CompiledAsset } from '../compile/compile-database.js';
import { AssetIntegrityError, AssetReadError } from '../load/errors.js';
import { openAsset } from '../load/open-asset.js';
import { readAsset } from '../load/read-asset.js';

import { createWorkerAnalyzer, type WorkerHandle } from './client.js';
import { connect } from './connect.js';
import type { Reply, Request } from './protocol.js';
import { serve } from './serve.js';
import type { WebEvent } from './web-globals.js';

/** A web-style worker running the host in process; replies can be held and released in any order. */
class FakeWebWorker implements WorkerHandle {
  terminated = false;
  hold = false;
  readonly held: Reply[] = [];
  private readonly listeners = new Map<string, ((event: WebEvent) => void)[]>();
  private handler: ((request: Request) => void) | null = null;

  constructor() {
    serve(
      {
        onRequest: (handler) => {
          this.handler = handler;
        },
        postReply: (reply) => {
          const copy = structuredClone(reply);
          if (this.hold) {
            this.held.push(copy);
          } else {
            setTimeout(() => this.emit('message', { data: copy }), 0);
          }
        },
      },
      openAsset,
    );
  }

  addEventListener(type: string, listener: (event: WebEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, event: WebEvent): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  /** The transfer lists posted, in order. */
  readonly transfers: ArrayBuffer[][] = [];

  postMessage(message: unknown, transfer: ArrayBuffer[]): void {
    this.transfers.push(transfer);
    const copy = structuredClone(message, { transfer }) as Request;
    setTimeout(() => {
      if (!this.terminated) {
        (this.handler as (request: Request) => void)(copy);
      }
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Deliver the held replies, last first. */
  releaseReversed(): void {
    for (const reply of this.held.splice(0).reverse()) {
      this.emit('message', { data: reply });
    }
  }
}

/** A Node-style worker over the same fake, recording ref and unref. */
class FakeNodeWorker extends FakeWebWorker {
  readonly refs: ('ref' | 'unref')[] = [];

  on(event: string, listener: (value: unknown) => void): void {
    this.addEventListener(event, (e) => listener(event === 'message' ? e.data : e.error));
  }

  ref(): void {
    this.refs.push('ref');
  }

  unref(): void {
    this.refs.push('unref');
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('createWorkerAnalyzer', () => {
  it('analyzes as the in-thread Analyzer', async () => {
    const wa = await createWorkerAnalyzer({ source: MINI_DB, flags: 'r', worker: new FakeWebWorker() });
    const inThread = new Analyzer(parseAlmor(MINI_DB, { flags: 'r' }));
    for (const word of ['كتاب', 'الكتاب', 'وكتبت', 'ابجد']) {
      expect(await wa.analyze(word)).toEqual(inThread.analyze(word));
    }
    expect(await wa.analyzeWords(['كتاب', 'يكتب'])).toEqual(inThread.analyzeWords(['كتاب', 'يكتب']));
    expect(await wa.tokFeats()).toEqual(parseAlmor(MINI_DB, { flags: 'r' }).tokFeats());
  });

  it('settles overlapping calls on their own replies, whatever order the replies come in', async () => {
    const worker = new FakeWebWorker();
    const wa = await createWorkerAnalyzer({ source: MINI_DB, worker });
    const inThread = new Analyzer(parseAlmor(MINI_DB, { flags: 'a' }));
    worker.hold = true;
    const words = ['كتاب', 'الكتاب', 'كبير', 'وكتب'];
    const calls = words.map((word) => wa.analyze(word));
    await tick();
    expect(worker.held).toHaveLength(words.length);
    worker.releaseReversed();
    const results = await Promise.all(calls);
    results.forEach((result, i) => expect(result).toEqual(inThread.analyze(words[i] as string)));
  });

  it('rejects with the engine error class when init fails', async () => {
    const failed = createWorkerAnalyzer({ source: MINI_DB, flags: 'q', worker: new FakeWebWorker() });
    await expect(failed).rejects.toBeInstanceOf(InvalidDatabaseFlagError);
    await expect(failed).rejects.toMatchObject({ name: 'InvalidDatabaseFlagError', flag: 'q' });
  });

  it('rejects pending and later calls with Error("worker terminated") on terminate', async () => {
    const worker = new FakeWebWorker();
    const wa = await createWorkerAnalyzer({ source: MINI_DB, worker });
    worker.hold = true;
    const pending = wa.analyze('كتاب');
    await wa.terminate();
    expect(worker.terminated).toBe(true);
    await expect(pending).rejects.toThrow('worker terminated');
    await expect(wa.analyze('كتاب')).rejects.toThrow('worker terminated');
  });

  it('rejects every pending call on an error event, and on a messageerror', async () => {
    for (const [type, expected] of [
      ['error', 'boom'],
      ['messageerror', 'a worker reply could not be deserialized'],
    ] as const) {
      const worker = new FakeWebWorker();
      const wa = await createWorkerAnalyzer({ source: MINI_DB, worker });
      worker.hold = true;
      const calls = [wa.analyze('كتاب'), wa.allFeats()];
      worker.emit(type, { message: 'boom', error: new Error('boom') });
      for (const call of calls) {
        await expect(call).rejects.toThrow(expected);
      }
    }
  });

  it('copies bytes by default, and transfers an ArrayBuffer or a whole Uint8Array when asked', async () => {
    const encode = (): Uint8Array => new TextEncoder().encode(MINI_DB);
    const copied = encode();
    await createWorkerAnalyzer({ source: copied.buffer as ArrayBuffer, worker: new FakeWebWorker() });
    expect(copied.byteLength).toBeGreaterThan(0);
    const moved = encode();
    await createWorkerAnalyzer({ source: moved.buffer as ArrayBuffer, transfer: true, worker: new FakeWebWorker() });
    expect(moved.byteLength).toBe(0);
    const whole = encode();
    await createWorkerAnalyzer({ source: whole, transfer: true, worker: new FakeWebWorker() });
    expect(whole.byteLength).toBe(0);
    // A view of part of a buffer is copied even with transfer.
    const padded = new Uint8Array(encode().length + 4);
    padded.set(encode(), 2);
    const part = padded.subarray(2, padded.length - 2);
    const wa = await createWorkerAnalyzer({ source: part, transfer: true, worker: new FakeWebWorker() });
    expect(part.byteLength).toBeGreaterThan(0);
    expect(await wa.analyze('كتاب')).toEqual(new Analyzer(parseAlmor(MINI_DB, { flags: 'a' })).analyze('كتاب'));
  });

  it('refuses a source of another type and, in client.ts, a worker it would have to start', async () => {
    await expect(createWorkerAnalyzer({ source: 42 as unknown as string, worker: new FakeWebWorker() })).rejects.toThrow(
      TypeError,
    );
    await expect(createWorkerAnalyzer({ source: MINI_DB })).rejects.toThrow(TypeError);
    await expect(createWorkerAnalyzer({ source: MINI_DB, worker: 'entry-web.js' })).rejects.toThrow(TypeError);
  });

  it('keeps a Node worker it started referenced only while a call is pending', async () => {
    const worker = new FakeNodeWorker();
    const wa = await connect(worker, true, { source: MINI_DB }, readAsset);
    expect(worker.refs.at(-1)).toBe('unref');
    const call = wa.analyze('كتاب');
    expect(worker.refs.at(-1)).toBe('ref');
    await call;
    expect(worker.refs.at(-1)).toBe('unref');
    // A worker the caller started is left as it is.
    const theirs = new FakeNodeWorker();
    await connect(theirs, false, { source: MINI_DB }, readAsset);
    expect(theirs.refs).toEqual([]);
  });
});

describe('createWorkerAnalyzer with an Asset source', () => {
  const sha256 = async (bytes: Uint8Array) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  let compiled: CompiledAsset | null = null;
  const asset = async (): Promise<CompiledAsset> => {
    if (compiled === null) {
      const db = new TextEncoder().encode(MINI_DB);
      compiled = await compileDatabase(db, {
        id: 'mini-db',
        name: 'Mini DB',
        version: '0.1',
        source: 'https://example.invalid/mini.db',
        sourceSha256: await sha256(db),
        sourceBytes: db.length,
        license: { id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
        credits: 'Invented test database.',
        disclaimer: 'Invented disclaimer.',
        citation: 'Invented citation.',
      });
    }
    return compiled;
  };
  /** A reader over the compiled Asset, recording each path it is asked for. */
  const readerOf = (a: CompiledAsset, asked: string[], change?: (path: string, b: Uint8Array) => void) => async (path: string) => {
    asked.push(path);
    const bytes = (path === 'manifest.json' ? a.manifest : (a.shards[path] as Uint8Array)).slice();
    change?.(path, bytes);
    return bytes;
  };

  it('reads the Asset on this thread, transfers its buffers, and carries the Provenance', async () => {
    const a = await asset();
    const asked: string[] = [];
    const worker = new FakeWebWorker();
    const wa = await createWorkerAnalyzer({
      source: { asset: readerOf(a, asked), manifestSha256: a.assetDigest },
      flags: 'r',
      worker,
    });
    expect(asked.sort()).toEqual(['header.bin', 'manifest.json', 'stems.bin']);
    expect(worker.transfers[0]).toHaveLength(3);
    for (const buffer of worker.transfers[0] as ArrayBuffer[]) {
      expect(buffer.byteLength).toBe(0); // detached: transferred, not copied
    }
    expect(wa.provenance?.assetDigest).toBe(a.assetDigest);
    expect(wa.provenance?.license).toEqual({ id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' });
    expect(Object.isFrozen(wa.provenance)).toBe(true);
    expect(Object.isFrozen(wa.provenance?.license)).toBe(true);
    const inThread = new Analyzer(parseAlmor(MINI_DB, { flags: 'r' }));
    expect(await wa.analyze('الكتاب')).toEqual(inThread.analyze('الكتاب'));
    await wa.terminate();
  });

  it('has no Provenance for a text or bytes source', async () => {
    const wa = await createWorkerAnalyzer({ source: MINI_DB, worker: new FakeWebWorker() });
    expect(wa.provenance).toBeNull();
  });

  it('refuses a wrong pin before any Shard is read, on this thread', async () => {
    const a = await asset();
    const asked: string[] = [];
    const worker = new FakeWebWorker();
    const e = await createWorkerAnalyzer({ source: { asset: readerOf(a, asked), manifestSha256: 'f'.repeat(64) }, worker }).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(AssetIntegrityError);
    expect(asked).toEqual(['manifest.json']);
    expect(worker.transfers).toEqual([]);
  });

  it('rejects with the worker\'s asset error as its own class, with its fields', async () => {
    const a = await asset();
    const flip = (path: string, b: Uint8Array) => {
      if (path === 'stems.bin') b[b.length >> 1] = (b[b.length >> 1] as number) ^ 1;
    };
    const e = await createWorkerAnalyzer({ source: { asset: readerOf(a, [], flip) }, worker: new FakeWebWorker() }).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(AssetIntegrityError);
    expect(e).toBeInstanceOf(DatabaseError);
    expect(e).toMatchObject({ name: 'AssetIntegrityError', path: 'stems.bin' });
    // A changed stored byte fails in the decompressor or at the hash; either way the fields cross.
    expect(Object.keys(e as object)).toEqual(['name', 'path', 'expected', 'actual']);
    expect((e as AssetIntegrityError).expected).not.toBe('');
    expect((e as AssetIntegrityError).actual).not.toBe('');
  });

  it('rejects a reader that fails as AssetReadError, and a source of another shape as TypeError', async () => {
    const failing = async (): Promise<ArrayBuffer> => {
      throw new Error('cache miss');
    };
    await expect(createWorkerAnalyzer({ source: { asset: failing }, worker: new FakeWebWorker() })).rejects.toBeInstanceOf(
      AssetReadError,
    );
    await expect(
      createWorkerAnalyzer({ source: { bytes: 1 } as unknown as string, worker: new FakeWebWorker() }),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      createWorkerAnalyzer({ source: { asset: 42 } as unknown as string, worker: new FakeWebWorker() }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe('WorkerAnalyzer.lookup', () => {
  const plain = (records: readonly { surface: string; category: string; features: Readonly<Record<string, string>> }[]): unknown =>
    records.map((r) => [r.surface, r.category, Object.entries(r.features)]);

  it('looks up as the in-thread Lexicon, with the Fold and a features subset', async () => {
    const wa = await createWorkerAnalyzer({ source: MINI_DB, flags: 'r', worker: new FakeWebWorker() });
    const inThread = new Lexicon(parseAlmor(MINI_DB, { flags: 'r' }));
    for (const [by, key] of [
      ['lemma', 'كِتاب'],
      ['lemma', 'كتاب'],
      ['stem', 'كتب'],
      ['stem', 'كَتب'],
      ['root', 'ك.ت.ب'],
      ['stem', 'zz'],
    ] as [LookupKey, string][]) {
      for (const options of [undefined, { fold: true }, { features: ['pos'] }, { fold: true, features: ['gen', 'diac'] }]) {
        expect(plain(await wa.lookup(by, key, options))).toEqual(plain(inThread.lookup(by, key, options)));
      }
    }
    const subset = await wa.lookup('stem', 'كتب', { features: ['vox', 'pos'] });
    expect(subset.map((r) => Object.keys(r.features))).toEqual([['pos'], ['pos', 'vox'], ['pos', 'vox'], ['pos', 'vox']]);
    await wa.terminate();
  });

  it('settles overlapping lookups and analyses on their own replies, whatever order the replies come in', async () => {
    const worker = new FakeWebWorker();
    const wa = await createWorkerAnalyzer({ source: MINI_DB, worker });
    const db = parseAlmor(MINI_DB, { flags: 'a' });
    const inThread = new Lexicon(db);
    const analyzer = new Analyzer(db);
    worker.hold = true;
    const lookups: [LookupKey, string, boolean][] = [
      ['stem', 'كتب', false],
      ['lemma', 'كتاب', true],
      ['stem', 'كبير', false],
      ['lemma', 'كَتَب', false],
    ];
    const pending = lookups.map(([by, key, fold]) => wa.lookup(by, key, { fold }));
    const analysis = wa.analyze('كتاب');
    const failing = wa.lookup('lex' as LookupKey, 'كتب');
    failing.catch(() => undefined);
    await tick();
    expect(worker.held).toHaveLength(lookups.length + 2);
    worker.releaseReversed();
    const results = await Promise.all(pending);
    results.forEach((result, i) => {
      const [by, key, fold] = lookups[i] as [LookupKey, string, boolean];
      expect(plain(result)).toEqual(plain(inThread.lookup(by, key, { fold })));
    });
    expect(results.some((r) => r.length > 0)).toBe(true);
    expect(await analysis).toEqual(analyzer.analyze('كتاب'));
    await expect(failing).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects a bad Lookup_Key or key with a TypeError, crossing as its class', async () => {
    const wa = await createWorkerAnalyzer({ source: MINI_DB, worker: new FakeWebWorker() });
    const inThread = new Lexicon(parseAlmor(MINI_DB, { flags: 'a' }));
    for (const [by, key] of [
      ['lex', 'كتب'],
      [7, 'كتب'],
      [null, 'كتب'],
      ['stem', 7],
      ['stem', null],
      ['root', { k: 'كتب' }],
    ] as unknown as [LookupKey, string][]) {
      let want: unknown;
      try {
        inThread.lookup(by, key);
      } catch (e) {
        want = e;
      }
      const got = wa.lookup(by, key);
      await expect(got).rejects.toBeInstanceOf(TypeError);
      await expect(got).rejects.toMatchObject({ name: 'TypeError', message: (want as Error).message });
    }
    // What structured clone cannot carry is refused on this thread, as a TypeError too.
    await expect(wa.lookup(Symbol('stem') as unknown as LookupKey, 'كتب')).rejects.toBeInstanceOf(TypeError);
    await expect(wa.lookup('stem', (() => 'كتب') as unknown as string)).rejects.toBeInstanceOf(TypeError);
    // The worker still answers.
    expect(plain(await wa.lookup('stem', 'كتب'))).toEqual(plain(inThread.lookup('stem', 'كتب')));
    await wa.terminate();
  });

  it('cannot be reached over a model without analysis: a g creation rejects with the AnalyzerError', async () => {
    const failed = createWorkerAnalyzer({ source: MINI_DB, flags: 'g', worker: new FakeWebWorker() });
    await expect(failed).rejects.toBeInstanceOf(AnalyzerError);
    await expect(failed).rejects.toMatchObject({ message: 'DB does not support analysis' });
  });
});
