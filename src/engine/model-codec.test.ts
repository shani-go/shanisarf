// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the Model_Codec: an in-memory `decodeModel(encodeModel(m))`
// round trip over a small hand-written ALMOR text
// (tests/support/generation-mini-db.ts, invented words) under `a`, `g` and
// `r`, the encoder's refusals, the UTF-16 string fallback, and one example per
// structural check, each failing with an `AssetFormatError` that names its
// Section.

import { describe, expect, it } from 'vitest';

import { AssetFormatError } from '../load/errors.js';
import { type AnyDb, modelDifferences, sharingDifferences } from '../../tests/property/model-compare.js';
import { MINI_DB } from '../../tests/support/generation-mini-db.js';

import { parseAlmor } from './almor-parser.js';
import { Analyzer } from './analyzer.js';
import { readDatabaseFlags, tupleModelOf } from './database.js';
import { Generator } from './generator.js';
import {
  type DecodedPart,
  decodeModel,
  encodeModel,
  HEADER_SECTIONS,
  type SectionArray,
  sectionType,
  STEM_SECTIONS,
} from './model-codec.js';
import { serializeAlmor } from './almor-serializer.js';

/** A mutable decoded part: the meta as JSON would give it back, and fresh copies of the arrays. */
interface Part {
  meta: Record<string, unknown>;
  sections: Map<string, SectionArray>;
  path?: string;
}

/** The parts of `text` parsed with `r`, as the Container reader would give them back. */
function partsOf(text: string): { header: Part; stem: Part } {
  const encoded = encodeModel(parseAlmor(text, { flags: 'r' }));
  const part = (e: (typeof encoded)['header'] | (typeof encoded)['stem']): Part => ({
    meta: JSON.parse(JSON.stringify(e.meta)) as Record<string, unknown>,
    sections: new Map(e.sections.map(([name, array]) => [name, array.slice()])),
  });
  return { header: part(encoded.header), stem: part(encoded.stem) };
}

function decode(parts: { header: Part; stem: Part }, flags = 'r') {
  return decodeModel(parts.header as DecodedPart, parts.stem as DecodedPart, readDatabaseFlags(flags), null);
}

/** The words of MINI_DB's stems with each prefix and suffix, plus a nonword. */
const WORDS = ['كتاب', 'الكتاب', 'وكتب', 'يكتبت', 'كتابه', 'كبير', 'الكبير', 'زززز'];

describe('the Model_Codec round trip', () => {
  for (const flags of ['a', 'g', 'r', 'ag', 'gr']) {
    it(`decodes to the parsed model under ${flags}`, () => {
      const parsed = parseAlmor(MINI_DB, { flags });
      const loaded = decode(partsOf(MINI_DB), flags);
      expect(modelDifferences(loaded, parsed as AnyDb)).toEqual([]);
      expect(sharingDifferences(loaded)).toEqual([]);
      expect(loaded.counts()).toEqual(parsed.counts());
      expect(loaded.flags).toEqual(parsed.flags);
      expect(Object.isFrozen(loaded.flags)).toBe(true);
      expect(loaded.provenance).toBeNull();
      if (parsed.flags.analysis) {
        expect(serializeAlmor(loaded)).toBe(serializeAlmor(parsed));
        for (const backoff of ['NONE', 'NOAN_ALL', 'ADD_PROP'] as const) {
          const a = new Analyzer(loaded, { backoff });
          const b = new Analyzer(parsed, { backoff });
          for (const word of WORDS) {
            expect(a.analyze(word).map(Object.entries)).toEqual(b.analyze(word).map(Object.entries));
          }
        }
      }
      if (parsed.flags.generation) {
        const a = new Generator(loaded);
        const b = new Generator(parsed);
        for (const [lemma, pos] of [['كِتاب_1', 'noun'], ['كَتَب_1', 'verb'], ['كَبِير_1', 'adj']] as const) {
          expect(a.generate(lemma, { pos }).map(Object.entries)).toEqual(b.generate(lemma, { pos }).map(Object.entries));
        }
      }
    });
  }

  it('lays out the tables the flags keep as the builder does', () => {
    // A `g` parse interns no surfaces, so its string ids differ from the
    // `r`-compiled Asset's; every table that holds no string id is compared
    // under every flag, and the rest under `a` and `r`.
    for (const flags of ['a', 'g', 'r']) {
      const want = tupleModelOf(parseAlmor(MINI_DB, { flags }));
      const got = tupleModelOf(decode(partsOf(MINI_DB), flags));
      for (const key of ['ab', 'bc', 'ac', 'abOrder', 'bcOrder', 'acOrder', 'stemPrefixOrder'] as const) {
        expect(got.header[key], `${flags} ${key}`).toEqual(want.header[key]);
      }
      for (const key of ['prefixCatIndex', 'suffixCatIndex', 'prefixIndex', 'suffixIndex'] as const) {
        expect(got.header[key], `${flags} ${key}`).toEqual(want.header[key]);
      }
      for (const key of ['prefixes', 'suffixes'] as const) {
        const { values, dense, ...rest } = got.header[key];
        const { values: wantValues, dense: wantDense, ...wantRest } = want.header[key];
        expect(rest, `${flags} ${key}`).toEqual(wantRest);
        expect(dense?.map((id) => Math.sign(id + 1)), `${flags} ${key}.dense`).toEqual(wantDense?.map((id) => Math.sign(id + 1)));
        if (flags !== 'g') {
          expect(values, `${flags} ${key}.values`).toEqual(wantValues);
          expect(dense, `${flags} ${key}.dense`).toEqual(wantDense);
        }
      }
      expect(got.stem.stemIndex, `${flags} stemIndex`).toEqual(want.stem.stemIndex);
      expect(got.stem.lemmaIndex, `${flags} lemmaIndex`).toEqual(want.stem.lemmaIndex);
      if (flags !== 'g') {
        expect(got.stem.stems, `${flags} stems`).toEqual(want.stem.stems);
        expect(got.strings, `${flags} strings`).toEqual(want.strings);
      }
      expect(got.header.schema, `${flags} schema`).toEqual(want.header.schema);
      expect([got.header.maxPrefixSize, got.header.maxSuffixSize]).toEqual([want.header.maxPrefixSize, want.header.maxSuffixSize]);
    }
  });

  it('stores Format_Version 1\'s Sections in order, each with its Filter', () => {
    const encoded = encodeModel(parseAlmor(MINI_DB, { flags: 'r' }));
    expect(encoded.header.sections.map(([name]) => name)).toEqual(HEADER_SECTIONS.map(([name]) => name));
    expect(encoded.stem.sections.map(([name]) => name)).toEqual(STEM_SECTIONS.map(([name]) => name));
    for (const [name, array, filter] of [...encoded.header.sections, ...encoded.stem.sections]) {
      const want = array instanceof Uint8Array ? 'none' : /\.(start|valueStart)$/u.test(name) ? 'delta-shuffle' : 'shuffle';
      expect(filter, name).toBe(want);
    }
    expect(encoded.header.meta.stringEncoding).toBe('utf-8');
    expect(sectionType(encoded.header.sections[0]![1])).toBe('u8');
  });

  it('refuses a model without both sides', () => {
    expect(() => encodeModel(parseAlmor(MINI_DB, { flags: 'a' }))).toThrow(TypeError);
    expect(() => encodeModel(parseAlmor(MINI_DB, { flags: 'g' }))).toThrow(TypeError);
  });

  it('stores a part with a lone surrogate as UTF-16 code units', () => {
    // An invented stem surface holding a lone high surrogate.
    const text = MINI_DB.replace('كبير\tA0', '\ud800كبير\tA0');
    const encoded = encodeModel(parseAlmor(text, { flags: 'r' }));
    expect(encoded.header.meta.stringEncoding).toBe('utf-8');
    expect(encoded.stem.meta.stringEncoding).toBe('utf-16');
    const loaded = decode(partsOf(text), 'r');
    expect(modelDifferences(loaded, parseAlmor(text, { flags: 'r' }) as AnyDb)).toEqual([]);
    expect(loaded.stems.has('\ud800كبير')).toBe(true);
  });

  it('keeps a define value upstream stores as None', () => {
    const text = MINI_DB.replace('DEFINE gen gen:m gen:f', 'DEFINE gen gen:m gen');
    const parsed = parseAlmor(text, { flags: 'r' });
    expect(parsed.defines.get('gen')).toEqual(['m', undefined]);
    expect(decode(partsOf(text)).defines.get('gen')).toEqual(['m', undefined]);
  });
});

/** Decoding `parts` after `change` throws an AssetFormatError naming `section`. */
function refuses(section: string, change: (parts: { header: Part; stem: Part }) => void): void {
  const parts = partsOf(MINI_DB);
  change(parts);
  let error: unknown;
  try {
    decode(parts);
  } catch (e) {
    error = e;
  }
  expect(error, section).toBeInstanceOf(AssetFormatError);
  expect((error as AssetFormatError).section).toBe(section);
  expect((error as AssetFormatError).message).toContain(section);
}

const u32 = (parts: { header: Part; stem: Part }, part: 'header' | 'stem', name: string): Uint32Array =>
  parts[part].sections.get(name) as Uint32Array;

describe('the decoder\'s structural checks', () => {
  it('names the file when the loader gives it', () => {
    const parts = partsOf(MINI_DB);
    parts.stem.path = 'stems.bin';
    parts.stem.sections.delete('stems.values');
    expect(() => decode(parts)).toThrow(/^stems\.bin, section stems\.values: the Section is missing$/u);
    try {
      decode(parts);
    } catch (e) {
      expect((e as AssetFormatError).path).toBe('stems.bin');
    }
  });

  it('shape: a missing, misplaced, mistyped, mis-sized or extra Section', () => {
    refuses('ab.ids'.replace('ab', 'abOrder'), (p) => p.header.sections.delete('abOrder.ids'));
    refuses('stems.layout', (p) => {
      const s = p.stem.sections;
      const layout = s.get('stems.layout')!;
      s.delete('stems.layout');
      s.set('stems.layout', layout);
    });
    refuses('prefixes.valueStart', (p) => p.header.sections.set('prefixes.valueStart', Int32Array.from(u32(p, 'header', 'prefixes.valueStart'))));
    refuses('prefixes.category', (p) => p.header.sections.set('prefixes.category', Uint32Array.from(p.header.sections.get('prefixes.category')!)));
    refuses('stems.valueStart', (p) => p.stem.sections.set('stems.valueStart', u32(p, 'stem', 'stems.valueStart').subarray(1)));
    refuses('strings.lengths', (p) => p.header.sections.set('strings.lengths', u32(p, 'header', 'strings.lengths').subarray(1)));
    refuses('extra.section', (p) => p.stem.sections.set('extra.section', new Uint8Array(0)));
  });

  it('meta: lacking flags, a bad count, a bad encoding, a repeated key', () => {
    refuses('meta.flags', (p) => ((p.header.meta['flags'] as Record<string, unknown>)['generation'] = false));
    refuses('meta.headerCount', (p) => (p.header.meta['headerCount'] = -1));
    refuses('meta.stringCount', (p) => (p.stem.meta['stringCount'] = 1.5));
    refuses('meta.stringEncoding', (p) => (p.stem.meta['stringEncoding'] = 'latin1'));
    refuses('meta.defines', (p) => {
      const defines = p.header.meta['defines'] as unknown[];
      defines.push(defines[0]);
    });
    refuses('meta.featureNames', (p) => (p.header.meta['featureNames'] as string[]).push('pos'));
  });

  it('start arrays: from 0, never decreasing, ending at their array\'s length', () => {
    refuses('layouts.start', (p) => (u32(p, 'header', 'layouts.start')[0] = 1));
    refuses('stemIndex.start', (p) => {
      const start = u32(p, 'stem', 'stemIndex.start');
      start[1] = (start[2] as number) + 1;
    });
    refuses('abOrder.start', (p) => {
      const start = u32(p, 'header', 'abOrder.start');
      start[start.length - 1] = (start[start.length - 1] as number) - 1;
    });
    refuses('suffixes.valueStart', (p) => (u32(p, 'header', 'suffixes.valueStart')[1] = 0));
  });

  it('string ids within their part\'s range', () => {
    const headerCount = (p: { header: Part }) => p.header.meta['headerCount'] as number;
    refuses('prefixes.values', (p) => (u32(p, 'header', 'prefixes.values')[0] = headerCount(p)));
    refuses('stemCats.names', (p) => (u32(p, 'header', 'stemCats.names')[0] = headerCount(p)));
    refuses('suffixIndex.keys', (p) => (u32(p, 'header', 'suffixIndex.keys')[0] = headerCount(p)));
    refuses('stems.values', (p) => (u32(p, 'stem', 'stems.values')[0] = headerCount(p) + (p.stem.meta['stringCount'] as number)));
  });

  it('Layout keys, Layout ids, category ids, entry ids and pair ids within their counts', () => {
    refuses('layouts.keys', (p) => ((p.header.sections.get('layouts.keys') as Uint16Array)[0] = (p.header.meta['featureNames'] as string[]).length));
    refuses('stems.layout', (p) => ((p.stem.sections.get('stems.layout') as Uint16Array)[0] = 0xffff));
    refuses('suffixes.category', (p) => ((p.header.sections.get('suffixes.category') as Uint16Array)[0] = 0xffff));
    refuses('prefixIndex.ids', (p) => (u32(p, 'header', 'prefixIndex.ids')[0] = 1_000_000));
    refuses('bcOrder.ids', (p) => (u32(p, 'header', 'bcOrder.ids')[0] = 1_000_000));
    refuses('stemPrefixOrder.rows', (p) => (u32(p, 'header', 'stemPrefixOrder.rows')[0] = 1_000_000));
  });

  it('a Tuple as long as its Layout, and every entry indexed once in line order', () => {
    refuses('stems.valueStart', (p) => {
      // Move one value from the first stem to the second: the totals still add up.
      const start = u32(p, 'stem', 'stems.valueStart');
      start[1] = (start[1] as number) - 1;
    });
    refuses('stemIndex.ids', (p) => {
      const ids = u32(p, 'stem', 'stemIndex.ids');
      ids[1] = ids[0] as number;
    });
    refuses('stemIndex.ids', (p) => {
      // كتب holds stems 1 to 4 in one slot; swap two.
      const ids = u32(p, 'stem', 'stemIndex.ids');
      [ids[1], ids[2]] = [ids[2] as number, ids[1] as number];
    });
  });

  it('distinct keys: Layout keys, pair rows and ids, role names and index keys', () => {
    refuses('layouts.keys', (p) => {
      const keys = p.header.sections.get('layouts.keys') as Uint16Array;
      keys[1] = keys[0] as number;
    });
    refuses('acOrder.rows', (p) => {
      const rows = u32(p, 'header', 'acOrder.rows');
      rows[1] = rows[0] as number;
    });
    refuses('acOrder.ids', (p) => {
      const ids = u32(p, 'header', 'acOrder.ids');
      ids[1] = ids[0] as number;
    });
    refuses('prefixCats.names', (p) => {
      const names = u32(p, 'header', 'prefixCats.names');
      names[1] = names[0] as number;
    });
    refuses('stemIndex.keys', (p) => {
      const keys = u32(p, 'stem', 'stemIndex.keys');
      keys[1] = keys[0] as number;
    });
  });

  it('the strings: lengths adding up to the text, and UTF-8', () => {
    refuses('strings.lengths', (p) => (u32(p, 'stem', 'strings.lengths')[0] = (u32(p, 'stem', 'strings.lengths')[0] as number) + 1));
    refuses('strings.text', (p) => {
      const text = p.header.sections.get('strings.text') as Uint8Array;
      text[0] = 0xff;
    });
  });
});
