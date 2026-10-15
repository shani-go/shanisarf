// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the Worker_Host, driven in process through a port whose
// messages go through structured clone (the worker-equals-in-thread property
// runs the host in a real worker). The database is the hand-made `MINI_DB`.
// The host opens an Asset it is sent, replies with the Provenance, and refuses
// a changed Shard or a wrong pin as the asset errors. A `lookup` after `init`
// equals the in-thread Lexicon's, with and without the Fold and a `features`
// subset; the host builds one Lexicon (counted through a module mock that
// subclasses it) and a fresh one after a later `init`; bad requests reply with
// the Lexicon's `TypeError`.

import { describe, expect, it, vi } from 'vitest';

import { MINI_DB } from '../../tests/support/generation-mini-db.js';
import { parseAlmor } from '../engine/almor-parser.js';
import { Analyzer, type AnalyzerOptions } from '../engine/analyzer.js';
import { CharMapper } from '../engine/charmap.js';
import { DatabaseError } from '../engine/errors.js';
import { Generator } from '../engine/generator.js';
import { Lexicon, type LookupKey, type LookupOptions } from '../engine/lexicon.js';
import { compileDatabase } from '../compile/compile-database.js';
import { type AssetBytes, openAsset } from '../load/open-asset.js';

import { decodeError, encodeError, type Reply, type Request, type Source, type WorkerAnalyzerOptions } from './protocol.js';
import { serve } from './serve.js';

type Call = (request: Request) => Reply;

/** How many Lexicons have been built in this file, the host's included. */
const lexicons = vi.hoisted(() => ({ built: 0 }));

vi.mock('../engine/lexicon.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../engine/lexicon.js')>();
  class CountedLexicon extends original.Lexicon {
    constructor(...args: ConstructorParameters<typeof original.Lexicon>) {
      super(...args);
      lexicons.built++;
    }
  }
  return { ...original, Lexicon: CountedLexicon };
});

/** A host behind a port that clones every message, and a way to call it. */
function startHost(): Call & { next(): Promise<Reply> } {
  let handler: ((request: Request) => void) | null = null;
  const replies: Reply[] = [];
  const waiting: ((reply: Reply) => void)[] = [];
  serve(
    {
      onRequest: (h) => {
        handler = h;
      },
      postReply: (reply) => {
        const copy = structuredClone(reply);
        replies.push(copy);
        waiting.shift()?.(copy);
      },
    },
    openAsset,
  );
  const call = (request: Request): Reply => {
    (handler as (request: Request) => void)(structuredClone(request));
    return replies[replies.length - 1] as Reply;
  };
  /** The next reply, for a request answered asynchronously (an Asset init). */
  call.next = (): Promise<Reply> => new Promise((resolve) => waiting.push(resolve));
  return call;
}

function value(reply: Reply): unknown {
  if (!reply.ok) {
    throw decodeError(reply.error);
  }
  expect(typeof reply.computeMs).toBe('number');
  expect(reply.computeMs).toBeGreaterThanOrEqual(0);
  return reply.value;
}

/** What a call threw in process, as name and message. */
function thrown(call: () => unknown): { name: string; message: string } {
  try {
    call();
  } catch (e) {
    return { name: (e as Error).name, message: (e as Error).message };
  }
  throw new Error('expected a throw');
}

function errorOf(reply: Reply): { name: string; message: string } {
  if (reply.ok) {
    throw new Error('expected an error reply');
  }
  return { name: reply.error.name, message: reply.error.message };
}

const init = (call: Call, source: Source, flags = 'r', analyzer: WorkerAnalyzerOptions = {}): Reply =>
  call({ id: 1, op: 'init', source, flags, analyzer });

const WORDS = ['كتاب', 'الكتاب', 'وكتب', 'يكتب', 'كتبت', 'ابجد', '  كبير  ', ''];

describe('the Worker_Host', () => {
  for (const [kind, source] of [
    ['text', { kind: 'text', text: MINI_DB }],
    ['bytes', { kind: 'bytes', bytes: new TextEncoder().encode(MINI_DB).buffer }],
  ] as const) {
    it(`builds the model from ${kind} and analyzes as the in-thread Analyzer`, () => {
      const call = startHost();
      expect(value(init(call, source))).toEqual({ provenance: null });
      const inThread = new Analyzer(parseAlmor(MINI_DB, { flags: 'r' }));
      for (const word of WORDS) {
        expect(value(call({ id: 2, op: 'analyze', word }))).toEqual(inThread.analyze(word));
      }
      expect(value(call({ id: 3, op: 'analyzeWords', words: WORDS }))).toEqual(inThread.analyzeWords(WORDS));
      expect(value(call({ id: 4, op: 'allFeats' }))).toEqual(parseAlmor(MINI_DB, { flags: 'r' }).allFeats());
    });
  }

  it('echoes each request id', () => {
    const call = startHost();
    init(call, { kind: 'text', text: MINI_DB });
    expect(call({ id: 41, op: 'analyze', word: 'كتاب' }).id).toBe(41);
    expect(call({ id: 42, op: 'tokFeats' }).id).toBe(42);
  });

  it('decodes bytes as readFileSync does: a byte order mark is kept, invalid sequences become U+FFFD', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(MINI_DB)]);
    const call = startHost();
    const bom = init(call, { kind: 'bytes', bytes: withBom.buffer });
    const inProcess = (() => {
      try {
        parseAlmor(Buffer.from(withBom).toString('utf8'), { flags: 'r' });
        return null;
      } catch (e) {
        return { name: (e as Error).name, message: (e as Error).message };
      }
    })();
    expect(bom.ok ? null : errorOf(bom)).toEqual(inProcess);

    // An invalid byte inside a stem's diac.
    const at = MINI_DB.indexOf('diac:كَبِير') + 'diac:'.length;
    const encoder = new TextEncoder();
    const bytes = new Uint8Array([
      ...encoder.encode(MINI_DB.slice(0, at)),
      0xff,
      ...encoder.encode(MINI_DB.slice(at)),
    ]);
    const decoded = Buffer.from(bytes).toString('utf8');
    expect(decoded).toContain('diac:�كَبِير');
    const call2 = startHost();
    value(init(call2, { kind: 'bytes', bytes: bytes.buffer }));
    expect(value(call2({ id: 2, op: 'analyze', word: 'كبير' }))).toEqual(
      new Analyzer(parseAlmor(decoded, { flags: 'r' })).analyze('كبير'),
    );
  });

  it('passes the analyzer options, rebuilding normMap', () => {
    const db = parseAlmor(MINI_DB, { flags: 'r' });
    const cases: [WorkerAnalyzerOptions, AnalyzerOptions][] = [
      [{ backoff: 'NOAN_ALL', strictDigit: true, cacheSize: 10 }, { backoff: 'NOAN_ALL', strictDigit: true, cacheSize: 10 }],
      [{ normMap: null }, { normMap: null }],
      [{ normMap: 'default' }, {}],
      [{ normMap: { charMap: { 'ك': 'ق' } } }, { normMap: new CharMapper({ 'ك': 'ق' }) }],
      [{ normMap: { charMap: { 'ك': 'ق' }, default: null } }, { normMap: new CharMapper({ 'ك': 'ق' }, null) }],
    ];
    for (const [crossing, inThread] of cases) {
      const call = startHost();
      value(init(call, { kind: 'text', text: MINI_DB }, 'r', crossing));
      const analyzer = new Analyzer(db, inThread);
      for (const word of ['كتاب', 'قتاب', 'ابجد']) {
        expect(value(call({ id: 2, op: 'analyze', word })), JSON.stringify(crossing)).toEqual(analyzer.analyze(word));
      }
    }
  });

  it('replies to an init that throws with the in-thread error', () => {
    const db = parseAlmor(MINI_DB, { flags: 'r' });
    expect(errorOf(init(startHost(), { kind: 'text', text: MINI_DB }, 'q'))).toEqual(
      thrown(() => parseAlmor(MINI_DB, { flags: 'q' })),
    );
    expect(errorOf(init(startHost(), { kind: 'text', text: MINI_DB }, 'r', { backoff: 'SOME' as 'NONE' }))).toEqual(
      thrown(() => new Analyzer(db, { backoff: 'SOME' as 'NONE' })),
    );
    expect(errorOf(init(startHost(), { kind: 'text', text: '###DEFINES###\nDEFINE x\n' }))).toEqual(
      thrown(() => parseAlmor('###DEFINES###\nDEFINE x\n', { flags: 'r' })),
    );
  });

  it('builds the Generator on the first generate, so its constructor error comes from that call', () => {
    const call = startHost();
    value(init(call, { kind: 'text', text: MINI_DB }, 'a'));
    const aDb = parseAlmor(MINI_DB, { flags: 'a' });
    expect(errorOf(call({ id: 2, op: 'generate', lemma: 'كِتاب_1', feats: { pos: 'noun' } }))).toEqual(
      thrown(() => new Generator(aDb)),
    );
    // The model still answers analysis.
    expect(value(call({ id: 3, op: 'analyze', word: 'كتاب' }))).toEqual(new Analyzer(aDb).analyze('كتاب'));
  });

  it('generates and reinflects as in thread, and replies with the in-thread errors', () => {
    const call = startHost();
    value(init(call, { kind: 'text', text: MINI_DB }));
    const db = parseAlmor(MINI_DB, { flags: 'r' });
    const generator = new Generator(db);
    expect(value(call({ id: 2, op: 'generate', lemma: 'كِتاب_1', feats: { pos: 'noun', num: 'p' } }))).toEqual(
      generator.generate('كِتاب_1', { pos: 'noun', num: 'p' }),
    );
    expect(errorOf(call({ id: 3, op: 'generate', lemma: 'كِتاب_1', feats: { pos: 'noun', zz: 'x' } }))).toEqual(
      thrown(() => generator.generate('كِتاب_1', { pos: 'noun', zz: 'x' })),
    );
  });

  it('replies to a call before init and to an unknown op with an Error', () => {
    const call = startHost();
    expect(errorOf(call({ id: 1, op: 'analyze', word: 'كتاب' }))).toEqual({
      name: 'Error',
      message: 'the worker has no model: init first',
    });
    expect(errorOf(call({ id: 2, op: 'nope' } as unknown as Request))).toEqual({ name: 'Error', message: 'unknown op "nope"' });
  });
});

describe('the Worker_Host with an Asset source', () => {
  const sha256 = async (bytes: Uint8Array) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const assetOf = async (): Promise<{ bytes: AssetBytes; digest: string }> => {
    const db = new TextEncoder().encode(MINI_DB);
    const compiled = await compileDatabase(db, {
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
    return { bytes: { manifest: compiled.manifest, shards: compiled.shards }, digest: compiled.assetDigest };
  };
  const initAsset = async (call: ReturnType<typeof startHost>, source: Source, flags = 'r'): Promise<Reply> => {
    const reply = call.next();
    call({ id: 1, op: 'init', source, flags, analyzer: {} });
    return reply;
  };

  it('opens the bytes it is sent, replies with the Provenance, and analyzes as in thread', async () => {
    const { bytes, digest } = await assetOf();
    const call = startHost();
    const result = value(await initAsset(call, { kind: 'asset', asset: bytes, manifestSha256: digest })) as {
      provenance: { assetDigest: string; credits: string };
    };
    expect(result.provenance.assetDigest).toBe(digest);
    expect(result.provenance.credits).toBe('Invented test database.');
    const inThread = new Analyzer(parseAlmor(MINI_DB, { flags: 'r' }));
    for (const word of WORDS) {
      expect(value(call({ id: 2, op: 'analyze', word }))).toEqual(inThread.analyze(word));
    }
    const generated = value(call({ id: 3, op: 'generate', lemma: 'كِتاب_1', feats: { pos: 'noun' } }));
    expect(generated).toEqual(new Generator(parseAlmor(MINI_DB, { flags: 'r' })).generate('كِتاب_1', { pos: 'noun' }));
  });

  it('refuses a changed Shard, a wrong pin and a bad flag as their own errors, and keeps no model', async () => {
    const { bytes, digest } = await assetOf();
    const changed: AssetBytes = { manifest: bytes.manifest, shards: { ...bytes.shards } };
    const stems = (changed.shards['stems.bin'] as Uint8Array).slice();
    stems[stems.length >> 1] = (stems[stems.length >> 1] as number) ^ 1;
    changed.shards['stems.bin'] = stems;
    const call = startHost();
    const integrity = await initAsset(call, { kind: 'asset', asset: changed });
    expect(integrity.ok).toBe(false);
    const error = decodeError((integrity as Extract<Reply, { ok: false }>).error);
    expect(error.name).toBe('AssetIntegrityError');
    expect(error).toMatchObject({ path: 'stems.bin' });
    expect(errorOf(call({ id: 2, op: 'analyze', word: 'كتاب' })).message).toBe('the worker has no model: init first');

    const pinned = await initAsset(call, { kind: 'asset', asset: bytes, manifestSha256: '0'.repeat(64) });
    expect(decodeError((pinned as Extract<Reply, { ok: false }>).error)).toMatchObject({
      name: 'AssetIntegrityError',
      path: 'manifest.json',
      actual: digest,
    });
    const flag = await initAsset(call, { kind: 'asset', asset: bytes }, 'q');
    expect(decodeError((flag as Extract<Reply, { ok: false }>).error).name).toBe('InvalidDatabaseFlagError');
  });
});

describe('the Worker_Host lookup', () => {
  const OPTIONS: (LookupOptions | undefined)[] = [
    undefined,
    { fold: true },
    { features: ['pos', 'lex', 'nothing'] },
    { fold: true, features: [] },
  ];

  /** Every key each Lookup_Key holds in MINI_DB under `flags`, with a folded and an absent one. */
  function keysOf(lexicon: Lexicon): [LookupKey, string][] {
    const keys: [LookupKey, string][] = [];
    for (const by of ['lemma', 'stem', 'root'] as const) {
      const held = new Set<string>(['', 'zz', 'كتاب']);
      for (const r of lexicon.entries()) {
        const k = by === 'stem' ? r.surface : r.features[by === 'lemma' ? 'lex' : 'root'];
        if (k !== undefined) held.add(k);
      }
      for (const k of held) keys.push([by, k]);
    }
    return keys;
  }

  for (const flags of ['a', 'r']) {
    it(`looks up as the in-thread Lexicon after init under ${flags}, with the Fold and a features subset`, () => {
      const call = startHost();
      value(init(call, { kind: 'text', text: MINI_DB }, flags));
      const inThread = new Lexicon(parseAlmor(MINI_DB, { flags }));
      let id = 10;
      let nonEmpty = 0;
      for (const [by, key] of keysOf(inThread)) {
        for (const options of OPTIONS) {
          const request: Request = options === undefined ? { id, op: 'lookup', by, key } : { id, op: 'lookup', by, key, options };
          const reply = call(request);
          expect(reply.id).toBe(id++);
          const got = value(reply) as { surface: string; category: string; features: Record<string, string> }[];
          const want = inThread.lookup(by, key, options);
          expect(got.map((r) => [r.surface, r.category, Object.entries(r.features)])).toEqual(
            want.map((r) => [r.surface, r.category, Object.entries(r.features)]),
          );
          if (want.length > 0) nonEmpty++;
        }
      }
      expect(nonEmpty).toBeGreaterThan(10);
      // The subset: Layout order, names no entry has ignored, an empty list gives empty features.
      const subset = value(call({ id: 99, op: 'lookup', by: 'lemma', key: 'كِتاب', options: { features: ['pos', 'lex'] } })) as {
        features: Record<string, string>;
      }[];
      expect(subset.length).toBe(2);
      for (const r of subset) expect(Object.keys(r.features)).toEqual(['lex', 'pos']);
    });
  }

  it('builds one Lexicon on the first lookup and keeps it until the next init', () => {
    const call = startHost();
    value(init(call, { kind: 'text', text: MINI_DB }));
    const before = lexicons.built;
    value(call({ id: 2, op: 'analyze', word: 'كتاب' }));
    expect(lexicons.built).toBe(before);
    for (let id = 3; id < 13; id++) {
      value(call({ id, op: 'lookup', by: id % 2 === 0 ? 'stem' : 'lemma', key: 'كتب', options: { fold: id % 3 === 0 } }));
    }
    expect(lexicons.built).toBe(before + 1);
    value(init(call, { kind: 'text', text: MINI_DB }, 'a'));
    value(call({ id: 20, op: 'lookup', by: 'stem', key: 'كتب' }));
    value(call({ id: 21, op: 'lookup', by: 'root', key: 'كتب' }));
    expect(lexicons.built).toBe(before + 2);
  });

  it("replies to a bad Lookup_Key, key or features with the Lexicon's TypeError, and before init with an Error", () => {
    const call = startHost();
    expect(errorOf(call({ id: 1, op: 'lookup', by: 'lemma', key: 'كتاب' }))).toEqual({
      name: 'Error',
      message: 'the worker has no model: init first',
    });
    value(init(call, { kind: 'text', text: MINI_DB }));
    const inThread = new Lexicon(parseAlmor(MINI_DB, { flags: 'r' }));
    const bad: [unknown, unknown, unknown][] = [
      ['lex', 'كتاب', undefined],
      ['', 'كتاب', undefined],
      [0, 'كتاب', undefined],
      [null, 'كتاب', undefined],
      ['stem', 0, undefined],
      ['stem', null, undefined],
      ['stem', undefined, undefined],
      ['root', ['ك'], { fold: true }],
      ['lemma', 'كتاب', { features: 'pos' }],
      ['lemma', 'كتاب', { features: ['pos', 1] }],
    ];
    let id = 2;
    for (const [by, key, options] of bad) {
      const reply = call({ id: id++, op: 'lookup', by, key, options } as unknown as Request);
      const want = thrown(() => inThread.lookup(by as LookupKey, key as string, options as LookupOptions));
      expect(want.name).toBe('TypeError');
      expect(errorOf(reply)).toEqual(want);
      expect(decodeError((reply as Reply & { ok: false }).error)).toBeInstanceOf(TypeError);
    }
    // The host still answers.
    expect(value(call({ id: 50, op: 'lookup', by: 'stem', key: 'كتب' }))).toEqual(inThread.lookup('stem', 'كتب'));
  });

  it('cannot hold a model without analysis: a g init is refused, and the Lexicon\'s DatabaseError would cross as its class', () => {
    const call = startHost();
    // init builds the Analyzer, which refuses the model first, so the host
    // keeps no model.
    expect(errorOf(init(call, { kind: 'text', text: MINI_DB }, 'g'))).toEqual(
      thrown(() => new Analyzer(parseAlmor(MINI_DB, { flags: 'g' }))),
    );
    expect(errorOf(call({ id: 2, op: 'lookup', by: 'lemma', key: 'كِتاب' }))).toEqual({
      name: 'Error',
      message: 'the worker has no model: init first',
    });
    // The constructor's refusal crosses as DatabaseError.
    let refusal: unknown;
    try {
      new Lexicon(parseAlmor(MINI_DB, { flags: 'g' }));
    } catch (e) {
      refusal = e;
    }
    const crossed = decodeError(structuredClone(encodeError(refusal)));
    expect(crossed).toBeInstanceOf(DatabaseError);
    expect(crossed.message).toBe('DB does not support analysis');
  });
});
