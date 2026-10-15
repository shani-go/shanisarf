// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Parity test for the twenty-one generated built-in character maps: each map
// (through the BUILTIN_CHARMAPS registry) equals the CAMeL Tools JSON it was
// generated from, entry for entry including `default`. The JSON is never
// committed; it lives in the git-ignored data/camel-tools-charmaps/ that
// tools/parity fills. When that directory is absent the test skips with a
// notice; the other charmap tests cover the committed .ts files.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BUILTIN_CHARMAP_NAMES,
  BUILTIN_CHARMAPS,
} from './charmaps/index.js';

/** The parsed shape of an upstream `<name>_map.json`. */
interface UpstreamCharMap {
  default: string | null;
  charMap: Record<string, string | null>;
}

// src/engine/ -> repo root is three levels up.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const upstreamDir = join(repoRoot, 'data', 'camel-tools-charmaps');

/** Read and parse an upstream map, or return null when its file is absent. */
function readUpstream(name: string): UpstreamCharMap | null {
  const path = join(upstreamDir, `${name}_map.json`);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as UpstreamCharMap;
}

describe('built-in charmaps match the upstream JSON', () => {
  if (!existsSync(upstreamDir)) {
    // Skip-with-notice: the git-ignored upstream JSON is not present. The
    // generated .ts maps are still exercised by charmap.test.ts.
    it.skip(
      `skipped: ${upstreamDir} is absent (run the parity fetch to generate it)`,
      () => {},
    );
    return;
  }

  for (const name of BUILTIN_CHARMAP_NAMES) {
    it(`${name} equals its upstream JSON entry for entry including default`, () => {
      const upstream = readUpstream(name);
      if (upstream === null) {
        // A single missing file in an otherwise-present directory: still a
        // notice, not a failure.
        console.warn(
          `[charmap parity] ${name}_map.json absent under ${upstreamDir}; skipping ${name}`,
        );
        return;
      }

      const generated = BUILTIN_CHARMAPS[name];
      expect(generated, `missing generated map ${name}`).toBeDefined();

      // Default: equal including null-vs-"" distinctions.
      expect(generated!.default).toBe(upstream.default);

      // charMap: same set of keys, same value per key, nothing extra on
      // either side. A plain object comparison asserts all of that at once
      // (key order is immaterial to parity; the generator preserves it, but
      // equality here is entry for entry).
      expect(generated!.charMap).toEqual(upstream.charMap);
    });
  }
});
