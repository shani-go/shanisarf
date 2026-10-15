// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Structural validation catches what hashing cannot. For any `almorDoc`
// Asset, apply one structural corruption to its Containers and rewrite the
// Manifest so every hash matches: a string id past its part's range, a Layout
// or category id past its count, a start array that decreases or ends short,
// an index entry id past its table, a missing Section, a Section of the wrong
// type, or two equal keys in one key list. Opening it through either entry's
// `openAsset` throws an `AssetFormatError` naming the Section, and builds no
// model.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { SectionArray } from '../../src/engine/model-codec.js';
import { AssetFormatError } from '../../src/load/errors.js';

import { almorDoc } from './arbitraries';
import { compileText, OPENERS, putTogether, takeApart, type TakenApart } from './asset-support';

interface HeaderMetaShape {
  headerCount: number;
  featureNames: string[];
  counts: { prefixes: number; suffixes: number };
}
interface StemMetaShape {
  stringCount: number;
  counts: { stems: number };
}

/** A corruption: it changes `t` and returns the Section (or `meta.<field>`) the open must name. */
type Corruption = (t: TakenApart, k: number) => string;

const header = (t: TakenApart) => t.parts.header.sections;
const stems = (t: TakenApart) => t.parts.stems.sections;
const hm = (t: TakenApart) => t.parts.header.meta as HeaderMetaShape;
const sm = (t: TakenApart) => t.parts.stems.meta as StemMetaShape;
const u32 = (sections: Map<string, SectionArray>, name: string) => sections.get(name) as Uint32Array;
const set = (array: SectionArray, k: number, value: number): void => {
  array[k % array.length] = value;
};

const CORRUPTIONS: Record<string, Corruption> = {
  'an affix value past the header strings': (t, k) => {
    set(u32(header(t), 'prefixes.values'), k, hm(t).headerCount + (k % 3));
    return 'prefixes.values';
  },
  'a role name past the header strings': (t, k) => {
    set(u32(header(t), 'suffixCats.names'), k, hm(t).headerCount);
    return 'suffixCats.names';
  },
  'a stem value past every string': (t, k) => {
    set(u32(stems(t), 'stems.values'), k, hm(t).headerCount + sm(t).stringCount + (k % 3));
    return 'stems.values';
  },
  'a Layout id past the Layout count': (t, k) => {
    set(stems(t).get('stems.layout') as SectionArray, k, u32(header(t), 'layouts.start').length - 1);
    return 'stems.layout';
  },
  'a category id past its role': (t, k) => {
    set(header(t).get('prefixes.category') as SectionArray, k, u32(header(t), 'prefixCats.names').length);
    return 'prefixes.category';
  },
  'a start array that decreases': (t) => {
    const start = u32(header(t), 'layouts.start');
    start[1] = (start[start.length - 1] as number) + 1;
    return 'layouts.start';
  },
  'a start array that ends short': (t, k) => {
    const choices = [
      [header(t), 'abOrder.start'],
      [header(t), 'prefixIndex.start'],
      [stems(t), 'stemIndex.start'],
      [header(t), 'layouts.start'],
    ] as const;
    const [sections, name] = choices[k % choices.length] as (typeof choices)[number];
    const start = u32(sections, name);
    start[start.length - 1] = (start[start.length - 1] as number) - 1;
    return name;
  },
  'an index entry id past its table': (t, k) => {
    if (k % 2 === 0) {
      set(u32(header(t), 'prefixIndex.ids'), k, hm(t).counts.prefixes);
      return 'prefixIndex.ids';
    }
    set(u32(stems(t), 'stemIndex.ids'), k, sm(t).counts.stems + 1);
    return 'stemIndex.ids';
  },
  'a missing Section': (t, k) => {
    const part = k % 2 === 0 ? header(t) : stems(t);
    const names = [...part.keys()];
    const name = names[k % names.length] as string;
    part.delete(name);
    return name;
  },
  'a Section of the wrong type': (t, k) => {
    const part = k % 2 === 0 ? header(t) : stems(t);
    const names = [...part.keys()];
    const name = names[k % names.length] as string;
    const array = part.get(name) as SectionArray;
    part.set(
      name,
      array instanceof Uint8Array
        ? Uint16Array.from(array)
        : array instanceof Uint16Array
          ? Uint32Array.from(array)
          : array instanceof Uint32Array
            ? Int32Array.from(array)
            : Uint32Array.from(array),
    );
    return name;
  },
  'two equal keys in one key list': (t, k) => {
    const lists = (
      [
        [header(t), 'prefixIndex.keys'],
        [header(t), 'suffixIndex.keys'],
        [stems(t), 'stemIndex.keys'],
        [header(t), 'prefixCats.names'],
        [header(t), 'stemCats.names'],
        [header(t), 'suffixCats.names'],
      ] as const
    ).filter(([sections, name]) => u32(sections, name).length >= 2);
    if (lists.length === 0) {
      const names = hm(t).featureNames;
      names[1] = names[0] as string;
      return 'meta.featureNames';
    }
    const [sections, name] = lists[k % lists.length] as (typeof lists)[number];
    const keys = u32(sections, name);
    const i = 1 + (k % (keys.length - 1));
    keys[i] = keys[0] as number;
    return name;
  },
};

describe('structural validation catches what hashing cannot', () => {
  it('refuses a structurally corrupt Asset whose hashes all match, naming the Section', async () => {
    await fc.assert(
      fc.asyncProperty(
        almorDoc,
        fc.constantFrom(...Object.keys(CORRUPTIONS)),
        fc.nat(),
        fc.constantFrom<'stream' | 'zlib'>('stream', 'zlib'),
        async (text, kind, k, opener) => {
          const taken = takeApart(await compileText(text));
          const section = (CORRUPTIONS[kind] as Corruption)(taken, k);
          const corrupt = putTogether(taken);
          let error: unknown;
          let model: unknown;
          try {
            model = await OPENERS[opener](corrupt, { flags: 'r' });
          } catch (e) {
            error = e;
          }
          expect(model, `${kind}: opened`).toBeUndefined();
          expect(error, kind).toBeInstanceOf(AssetFormatError);
          expect((error as AssetFormatError).section, kind).toBe(section);
          expect((error as AssetFormatError).message, kind).toContain(section);
          expect((error as AssetFormatError).path, kind).toMatch(/^(header|stems)\.bin$/u);
        },
      ),
      { numRuns: 100 },
    );
  });
});
