// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Generator for the twenty-one built-in character maps. It reads the
// upstream CAMeL Tools charmap
// JSON (`camel_tools/utils/charmaps/<name>_map.json`, version 1.6.0, MIT) and
// emits one `src/engine/charmaps/<name>.ts` per map plus an `index.ts`
// registry that `charmap.ts`'s `builtinMapper` consumes. Each emitted file is
// a data table *derived from* an upstream file, so the generator writes the
// ported-code notice at the head of every file it produces (see
// CONTRIBUTING.md). This generator's own logic is new design, so this
// file carries the project header only.
//
// How the generator finds the upstream JSON (first match wins):
//   1. a directory given as the first CLI argument;
//   2. the `SHANISARF_CHARMAPS_SRC` environment variable;
//   3. `data/camel-tools-charmaps/` under the repo root (the git-ignored
//      place `tools/parity` drops a copy of the upstream charmaps into);
//   4. a CAMeL Tools install under a `tools/parity/**/.venv` once the parity
//      venv is built (`.../site-packages/camel_tools/utils/charmaps`).
// The directory must hold the twenty-one `<name>_map.json` files. The raw
// JSON is never committed (it lives under the git-ignored `data/` or the
// venv); only the generated, MIT-derived `.ts` files are.
//
// Run with Node's native TypeScript support (Node >= 22.6 strips types):
//   node tools/gen-charmaps.ts [path/to/charmaps]

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The upstream file and version the emitted notice names, and the pointer the
// project's ported-code notice uses. Keep the version in step with the pin in
// tools/parity/requirements.txt (grep -rl 'Ported from CAMeL Tools').
const UPSTREAM_VERSION = '1.6.0';
const UPSTREAM_DIR = 'camel_tools/utils/charmaps';

// The twenty-one built-in maps, in upstream's order.
const MAP_NAMES = [
  'ar2bw',
  'ar2safebw',
  'ar2xmlbw',
  'ar2hsb',
  'bw2ar',
  'bw2safebw',
  'bw2xmlbw',
  'bw2hsb',
  'safebw2ar',
  'safebw2bw',
  'safebw2xmlbw',
  'safebw2hsb',
  'xmlbw2ar',
  'xmlbw2bw',
  'xmlbw2safebw',
  'xmlbw2hsb',
  'hsb2ar',
  'hsb2bw',
  'hsb2safebw',
  'hsb2xmlbw',
  'arclean',
] as const;

/** The parsed shape of an upstream `<name>_map.json`. */
interface UpstreamCharMap {
  default: string | null;
  charMap: Record<string, string | null>;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

/** Resolve the directory that holds the upstream `<name>_map.json` files. */
function resolveSourceDir(): string {
  const candidates: string[] = [];
  const cliArg = process.argv[2];
  if (cliArg) candidates.push(resolve(cliArg));
  const envDir = process.env['SHANISARF_CHARMAPS_SRC'];
  if (envDir) candidates.push(resolve(envDir));
  candidates.push(join(repoRoot, 'data', 'camel-tools-charmaps'));
  const venvHit = findInParityVenv();
  if (venvHit) candidates.push(venvHit);

  for (const dir of candidates) {
    if (existsSync(join(dir, `${MAP_NAMES[0]}_map.json`))) return dir;
  }

  throw new Error(
    `Could not find the upstream charmap JSON. Looked in:\n` +
      candidates.map((c) => `  - ${c}`).join('\n') +
      `\nPlace the twenty-one '<name>_map.json' files (from CAMeL Tools ` +
      `${UPSTREAM_VERSION}, ${UPSTREAM_DIR}) in one of those directories, or ` +
      `pass the path as the first argument.`,
  );
}

/** Best-effort discovery of a CAMeL Tools charmaps dir inside a parity venv. */
function findInParityVenv(): string | null {
  const parityDir = join(repoRoot, 'tools', 'parity');
  if (!existsSync(parityDir)) return null;
  const tail = join('camel_tools', 'utils', 'charmaps');
  // Walk a shallow tree looking for '.../site-packages/<tail>'.
  const stack = [parityDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = join(dir, entry.name);
      if (entry.name === 'site-packages') {
        const hit = join(child, tail);
        if (existsSync(join(hit, `${MAP_NAMES[0]}_map.json`))) return hit;
      }
      stack.push(child);
    }
  }
  return null;
}

/** The ported-code notice emitted at the head of every generated file. */
function portedNotice(generatedFrom: string): string {
  const year = new Date().getFullYear();
  return (
    `// Ported from CAMeL Tools ${UPSTREAM_DIR}/${generatedFrom} (version ${UPSTREAM_VERSION}).\n` +
    `// Copyright 2018-2026 New York University Abu Dhabi. MIT License.\n` +
    `// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.\n` +
    `// shanisarf's changes are Copyright ${year} shani-go (https://github.com/shani-go), MIT License.\n` +
    `//\n` +
    `// GENERATED by tools/gen-charmaps.ts from the upstream JSON named above.\n` +
    `// Do not edit by hand; re-run 'node tools/gen-charmaps.ts' to regenerate.\n`
  );
}

/**
 * Emit a TypeScript source literal for one upstream map. Keys and string
 * values are written as JSON string literals so every code point round-trips
 * exactly (JSON.stringify escapes control characters and leaves the rest as
 * UTF-16; the bytes equal the upstream entries code point for code point).
 * `null` values and `default` are preserved as `null`.
 */
function renderMapModule(name: string, map: UpstreamCharMap): string {
  const header = portedNotice(`${name}_map.json`);
  const entries = Object.entries(map.charMap)
    .map(([key, value]) => `  ${JSON.stringify(key)}: ${renderValue(value)},`)
    .join('\n');
  const defaultLit = renderValue(map.default);
  return (
    `${header}\n` +
    `/** The ${name} character map, generated from the upstream JSON. */\n` +
    `export const charMap: Readonly<Record<string, string | null>> = {\n` +
    `${entries}\n` +
    `};\n\n` +
    `/** The map's default value (applied to code points absent from charMap). */\n` +
    `const defaultValue: string | null = ${defaultLit};\n` +
    `export default defaultValue;\n`
  );
}

function renderValue(value: string | null): string {
  return value === null ? 'null' : JSON.stringify(value);
}

/** Emit the registry `index.ts` that wires names to their generated maps. */
function renderIndexModule(names: readonly string[]): string {
  const year = new Date().getFullYear();
  const header =
    `// Ported from CAMeL Tools ${UPSTREAM_DIR}/*.json (version ${UPSTREAM_VERSION}).\n` +
    `// Copyright 2018-2026 New York University Abu Dhabi. MIT License.\n` +
    `// The upstream license is reproduced in licenses/CAMEL_TOOLS_LICENSE; see NOTICE.\n` +
    `// shanisarf's changes are Copyright ${year} shani-go (https://github.com/shani-go), MIT License.\n` +
    `//\n` +
    `// GENERATED by tools/gen-charmaps.ts. Do not edit by hand.\n` +
    `//\n` +
    `// The registry of the twenty-one built-in character maps, keyed by name.\n` +
    `// charmap.ts's CharMapper.builtinMapper looks a name up here and builds a\n` +
    `// fresh CharMapper from the entry's { charMap, default }.\n`;

  const imports = names
    .map(
      (n) =>
        `import { charMap as ${camel(n)}CharMap } from './${n}.js';\n` +
        `import ${camel(n)}Default from './${n}.js';`,
    )
    .join('\n');

  const entries = names
    .map((n) => `  ${JSON.stringify(n)}: { charMap: ${camel(n)}CharMap, default: ${camel(n)}Default },`)
    .join('\n');

  return (
    `${header}\n` +
    `${imports}\n\n` +
    `/** A built-in map's data: its code-point map and its default value. */\n` +
    `export interface BuiltinCharMapData {\n` +
    `  readonly charMap: Readonly<Record<string, string | null>>;\n` +
    `  readonly default: string | null;\n` +
    `}\n\n` +
    `/** The twenty-one built-in maps, keyed by name. */\n` +
    `export const BUILTIN_CHARMAPS: Readonly<Record<string, BuiltinCharMapData>> = {\n` +
    `${entries}\n` +
    `};\n\n` +
    `/** The built-in map names, in registry order. */\n` +
    `export const BUILTIN_CHARMAP_NAMES = [\n` +
    names.map((n) => `  ${JSON.stringify(n)},`).join('\n') +
    `\n] as const;\n`
  );
}

/** Turn a map name into a valid JS identifier prefix (e.g. ar2bw -> ar2bw). */
function camel(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}

function main(): void {
  const sourceDir = resolveSourceDir();
  const outDir = join(repoRoot, 'src', 'engine', 'charmaps');
  mkdirSync(outDir, { recursive: true });

  for (const name of MAP_NAMES) {
    const jsonPath = join(sourceDir, `${name}_map.json`);
    const raw = readFileSync(jsonPath, 'utf8');
    const parsed = JSON.parse(raw) as UpstreamCharMap;
    if (typeof parsed !== 'object' || parsed === null || !('charMap' in parsed)) {
      throw new Error(`Malformed upstream map: ${jsonPath}`);
    }
    const module = renderMapModule(name, parsed);
    writeFileSync(join(outDir, `${name}.ts`), module, 'utf8');
  }

  writeFileSync(join(outDir, 'index.ts'), renderIndexModule(MAP_NAMES), 'utf8');

  console.log(
    `Generated ${MAP_NAMES.length} charmaps + index into ${outDir} from ${sourceDir}`,
  );
}

main();
