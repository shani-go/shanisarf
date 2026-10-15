// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The Worker_Host: it builds the model and the Analyzer inside the worker and
// answers the client's requests, one reply per request.
//
// - `init` builds the model from bytes (decoded as Node's
//   `readFileSync(path, 'utf8')` decodes: invalid sequences become U+FFFD, a
//   leading U+FEFF is kept, so a database with a byte order mark fails here
//   as it does in process) or from text as it is, or opens a compiled Asset
//   with the entry's `openAsset` under the init flags and the caller's
//   `manifestSha256`, and then builds the Analyzer with the caller's options.
//   It replies with the model's Provenance (`null` for a parsed model).
//   Opening an Asset is asynchronous, so that one reply follows its promise;
//   a later `init` supersedes one still opening.
// - The Generator and the Reinflector are built on the first `generate` or
//   `reinflect`, so their constructor errors reach the caller from that call.
// - The Lexicon is built over the model on the first `lookup` and kept until
//   the next `init`, so its indexes live here, where the model is. A bad
//   Lookup_Key or key throws the Lexicon's `TypeError`; a model without
//   analysis would throw its constructor's `DatabaseError`, though `init`
//   already refuses such a model when it builds the Analyzer.
// - Every reply carries the host's compute time. Every throw is replied in
//   its encoded form; an unknown op is replied as an `Error`.
//
// The host makes no request: data reaches it only in messages. For an Asset
// source the caller's thread read the Asset, and the host only opens the
// bytes it was sent; `openAsset` reads nothing but its arguments. Each entry
// passes its own `openAsset`: `entry-web` the stream inflate, `entry-node`
// `node:zlib`.
//
// This is a new-design file: project header only.

import { parseAlmor } from '../engine/almor-parser.js';
import { Analyzer, type AnalyzerOptions } from '../engine/analyzer.js';
import { CharMapper } from '../engine/charmap.js';
import type { MorphologyDb } from '../engine/database.js';
import { Generator } from '../engine/generator.js';
import { Lexicon } from '../engine/lexicon.js';
import { Reinflector } from '../engine/reinflector.js';
import type { AssetBytes, OpenOptions } from '../load/open-asset.js';

import {
  encodeError,
  type InitResult,
  type Reply,
  type Request,
  type Source,
  type WorkerAnalyzerOptions,
} from './protocol.js';

/** The host's two ends: each request arrives through `onRequest`, each reply leaves through `postReply`. */
export interface HostPort {
  onRequest(handler: (request: Request) => void): void;
  postReply(reply: Reply): void;
}

/** An entry's `openAsset`. */
export type AssetOpener = (bytes: AssetBytes, options: OpenOptions) => Promise<MorphologyDb>;

/** Answer the requests arriving on `port` until the worker ends, opening Assets with `openAsset`. */
export function serve(port: HostPort, openAsset: AssetOpener): void {
  let db: MorphologyDb | null = null;
  let analyzer: Analyzer | null = null;
  let generator: Generator | null = null;
  let reinflector: Reinflector | null = null;
  let lexicon: Lexicon | null = null;
  let inits = 0;

  const model = (): MorphologyDb => {
    if (db === null) {
      throw new Error('the worker has no model: init first');
    }
    return db;
  };

  const handle = (request: Request): unknown => {
    switch (request.op) {
      case 'init': {
        db = null;
        analyzer = null;
        generator = null;
        reinflector = null;
        lexicon = null;
        const init = ++inits;
        const ready = (built: MorphologyDb): InitResult => {
          if (init !== inits) {
            throw new Error('superseded by a later init');
          }
          analyzer = new Analyzer(built, analyzerOptions(request.analyzer));
          db = built;
          return { provenance: built.provenance };
        };
        const { source, flags } = request;
        if (source.kind === 'asset') {
          const options: OpenOptions =
            source.manifestSha256 === undefined ? { flags } : { flags, manifestSha256: source.manifestSha256 };
          return openAsset(source.asset, options).then(ready);
        }
        return ready(buildModel(source, flags));
      }
      case 'analyze':
        model();
        return (analyzer as Analyzer).analyze(request.word);
      case 'analyzeWords':
        model();
        return (analyzer as Analyzer).analyzeWords(request.words);
      case 'generate':
        generator ??= new Generator(model());
        return generator.generate(request.lemma, request.feats);
      case 'reinflect':
        reinflector ??= new Reinflector(model());
        return reinflector.reinflect(request.word, request.feats);
      case 'lookup':
        lexicon ??= new Lexicon(model());
        return lexicon.lookup(request.by, request.key, request.options);
      case 'allFeats':
        return model().allFeats();
      case 'tokFeats':
        return model().tokFeats();
      default:
        throw new Error(`unknown op ${JSON.stringify((request as { op?: unknown }).op)}`);
    }
  };

  const post = (reply: Reply): void => {
    try {
      port.postReply(reply);
    } catch (e) {
      // A value structured clone cannot carry: reply with why.
      port.postReply({ id: reply.id, ok: false, error: encodeError(e) });
    }
  };

  port.onRequest((request) => {
    const start = performance.now();
    let value: unknown;
    try {
      value = handle(request);
    } catch (e) {
      post({ id: request.id, ok: false, error: encodeError(e) });
      return;
    }
    if (value instanceof Promise) {
      value.then(
        (v: unknown) => post({ id: request.id, ok: true, value: v, computeMs: performance.now() - start }),
        (e: unknown) => post({ id: request.id, ok: false, error: encodeError(e) }),
      );
      return;
    }
    post({ id: request.id, ok: true, value, computeMs: performance.now() - start });
  });
}

/** The model a text or bytes `init` source stands for. */
function buildModel(source: Source, flags: string): MorphologyDb {
  switch (source.kind) {
    case 'bytes':
      return parseAlmor(new TextDecoder('utf-8', { ignoreBOM: true }).decode(source.bytes), { flags });
    case 'text':
      return parseAlmor(source.text, { flags });
    default:
      throw new TypeError(`unknown source kind ${JSON.stringify((source as { kind?: unknown }).kind)}`);
  }
}

/** The Analyzer's options from their crossing form; `normMap` is rebuilt here. */
function analyzerOptions(o: WorkerAnalyzerOptions): AnalyzerOptions {
  const options: AnalyzerOptions = {};
  if (o.backoff !== undefined) options.backoff = o.backoff;
  if (o.strictDigit !== undefined) options.strictDigit = o.strictDigit;
  if (o.cacheSize !== undefined) options.cacheSize = o.cacheSize;
  if (o.normMap === null) {
    options.normMap = null;
  } else if (o.normMap !== undefined && o.normMap !== 'default') {
    const spec = o.normMap;
    options.normMap = spec.default === undefined ? new CharMapper(spec.charMap) : new CharMapper(spec.charMap, spec.default);
  }
  return options;
}
