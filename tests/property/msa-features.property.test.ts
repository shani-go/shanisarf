// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The typed features are the pin's, an example test over the Database_Pin and
// the parity fixtures, skipped without data/. `MSA_FEATURE_NAMES` equals the
// pin's `order` and `MSA_DEFINES` its closed defines, in order; re-running
// scripts/gen-msa-features.mjs (over src/, under the TypeScript resolve hook)
// writes a file byte-identical to the committed module, and so does a run from
// the data package's Asset when it is compiled; and over every fixture
// analysis, each closed-set value a Lexical_Analysis carries is in its set,
// while the values other analyses carry outside their sets are exactly
// OUTSIDE_VALUES. The module's place in the import graph is checked beside it.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import * as engineEntry from '../../src/engine/index.js';
import * as browserRoot from '../../src/index.js';
import * as nodeRoot from '../../src/index-node.js';
import * as features from '../../src/msa-features.js';
import { isMsaValue, MSA_DEFINES, MSA_FEATURE_NAMES, type MsaDefineName } from '../../src/msa-features.js';
import { parseAlmor, type Analysis } from '../../src/engine/index.js';

import {
  DB_PATH,
  databaseAvailable,
  FIXTURES_DIR,
  GENERATION_DIR,
  listAnalyzerFixtures,
  readGenerationFixture,
  SETUP_HINT,
} from '../parity/replay-support';

/**
 * The values analyses other than Lexical_Analyses carry outside their closed
 * sets, as `name=value`, sorted. Both are written by a special path: `pos` `foreign`
 * by the foreign-word path (the `pos` define has no `foreign`) and `source`
 * `punc` by the punctuation path (the `source` define lists `punct`).
 */
const OUTSIDE_VALUES = ['pos=foreign', 'source=punc'];

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MODULE_PATH = join(ROOT, 'src', 'msa-features.ts');
const GENERATOR = join(ROOT, 'scripts', 'gen-msa-features.mjs');
const HOOK = join(ROOT, 'tests', 'support', 'ts-resolve-hook.mjs');
const ASSET_DIR = join(ROOT, 'packages', 'shanisarf-db-msa', 'asset');
const RECORD = JSON.parse(readFileSync(join(ROOT, 'packages', 'shanisarf-db-msa', 'source.json'), 'utf8')) as {
  sourceSha256: string;
};

const HAVE_PIN = databaseAvailable();
if (!HAVE_PIN) {
  console.warn(`msa-features property: SKIPPED — the Database_Pin is not under data/ (${SETUP_HINT}).`);
}

let work: string | undefined;
afterAll(() => {
  if (work !== undefined) rmSync(work, { recursive: true, force: true });
});

/** Run the Generator over src/ into a private directory and return the bytes it wrote. */
function generate(extra: readonly string[], name: string): Buffer {
  work ??= mkdtempSync(join(tmpdir(), 'shanisarf-consumer7-'));
  const out = join(work, name);
  const run = spawnSync(
    process.execPath,
    ['--import', HOOK, GENERATOR, '--engine', join(ROOT, 'src'), '--out', out, ...extra],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (run.status !== 0) throw new Error(`the Generator failed (${run.status}):\n${run.stdout}\n${run.stderr}`);
  return readFileSync(out);
}

describe('the typed features module\'s place', () => {
  it('is exported from both package-root entries, and not from the engine entry', () => {
    const names = Object.keys(features).sort();
    expect(names).toEqual(['MSA_DEFINES', 'MSA_FEATURE_NAMES', 'isMsaValue']);
    for (const root of [browserRoot, nodeRoot] as Record<string, unknown>[]) {
      for (const name of names) expect(root[name]).toBe((features as Record<string, unknown>)[name]);
    }
    for (const name of names) expect(name in engineEntry).toBe(false);
  });

  it('imports only the Analysis type, from the engine', () => {
    const text = readFileSync(MODULE_PATH, 'utf8');
    const imports = [...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gmu)].map((m) => m[0].trim());
    expect(imports).toEqual(["import type { Analysis } from './engine/analyzer.js'"]);
    expect(/\bimport\s*\(/u.test(text)).toBe(false);
  });

  it('narrows with isMsaValue: a value of the set, nothing else', () => {
    const [pos] = MSA_DEFINES.pos;
    expect(isMsaValue('pos', pos)).toBe(true);
    expect(isMsaValue('pos', 'foreign')).toBe(false);
    expect(isMsaValue('pos', 7)).toBe(false);
    expect(isMsaValue('pos', null)).toBe(false);
    expect(isMsaValue('toString' as MsaDefineName, 'x')).toBe(false);
    expect(isMsaValue('diac' as MsaDefineName, 'x')).toBe(false);
  });
});

describe('The typed features are the pin\'s', () => {
  it.skipIf(!HAVE_PIN)(
    'equals the pin\'s order and closed defines, and the Generator rewrites it byte for byte',
    () => {
      const bytes = readFileSync(DB_PATH);
      const db = parseAlmor(bytes.toString('utf8'), { flags: 'a' });

      expect([...MSA_FEATURE_NAMES]).toEqual(db.order);
      const closed = [...db.defines].filter((entry): entry is [string, readonly string[]] => entry[1] !== null);
      expect(Object.keys(MSA_DEFINES)).toEqual(closed.map(([name]) => name));
      for (const [name, values] of closed) {
        expect([...(MSA_DEFINES as Record<string, readonly string[]>)[name] ?? []], name).toEqual(values);
      }

      const committed = readFileSync(MODULE_PATH);
      expect(committed.toString('utf8')).toContain(RECORD.sourceSha256);
      expect(generate([], 'from-text.ts').equals(committed), 'a rerun from the text is byte-identical').toBe(true);
      if (existsSync(join(ASSET_DIR, 'manifest.json'))) {
        expect(generate(['--source', 'asset'], 'from-asset.ts').equals(committed), 'a run from the Asset is byte-identical').toBe(true);
      } else {
        console.warn('msa-features property: the Asset is not compiled (npm run compile:db); the run from the Asset is skipped.');
      }
    },
    120_000,
  );

  it.skipIf(!HAVE_PIN || !existsSync(FIXTURES_DIR))(
    'over the Fixtures, Lexical_Analyses stay in the closed sets; the others\' outside values are the recorded list',
    () => {
      const groups: { file: string; sha256: string; analyses: Analysis[] }[] = [];
      for (const fixture of listAnalyzerFixtures()) {
        groups.push({ file: fixture.file, sha256: fixture.database.sha256, analyses: fixture.cases.flatMap((c) => c.analyses) });
      }
      if (existsSync(GENERATION_DIR)) {
        for (const name of readdirSync(GENERATION_DIR).filter((n) => n.endsWith('.json.gz')).sort()) {
          const fixture = readGenerationFixture(name);
          groups.push({ file: `generation/${name}`, sha256: fixture.database.sha256, analyses: fixture.cases.flatMap((c) => c.analyses ?? []) });
        }
      }
      expect(groups.length).toBeGreaterThan(0);

      const sets = Object.entries(MSA_DEFINES) as [string, readonly string[]][];
      const lexicalOutside: string[] = [];
      const outside = new Map<string, number>();
      let lexical = 0;
      let others = 0;
      for (const { file, sha256, analyses } of groups) {
        expect(sha256, `${file} was generated over the pin`).toBe(RECORD.sourceSha256);
        for (const analysis of analyses) {
          const isLexical = analysis['source'] === 'lex' || analysis['source'] === 'spvar';
          if (isLexical) lexical++;
          else others++;
          for (const [name, values] of sets) {
            if (!(name in analysis)) continue;
            const value = analysis[name];
            if (typeof value === 'string' && values.includes(value)) continue;
            const pair = `${name}=${String(value)}`;
            if (isLexical) lexicalOutside.push(`${file}: ${pair}`);
            else outside.set(pair, (outside.get(pair) ?? 0) + 1);
          }
        }
      }

      console.log(
        `msa-features property: ${groups.length} fixtures, ${lexical} Lexical_Analyses and ${others} others; ` +
          `outside values of the others: ${[...outside].map(([pair, n]) => `${pair} (${n})`).join(', ') || 'none'}.`,
      );
      expect(lexicalOutside.slice(0, 10)).toEqual([]);
      expect([...outside.keys()].sort()).toEqual(OUTSIDE_VALUES);
    },
    120_000,
  );
});
