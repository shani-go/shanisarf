// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Carries the ported-code notice into the declaration files. tsc keeps a
// file's leading `//` comments in the ESM and CJS builds but drops them from
// the `.d.ts` it emits, so dist/engine/**/*.d.ts and dist/cjs/engine/**/*.d.ts
// would ship without the notice CONTRIBUTING.md requires on every ported file.
// For each source under src/engine/ whose first line is the notice, this
// prepends the same notice block (its leading `//` lines, up to the first
// bare `//`) to both matching declaration files, the ESM one and the CJS one.
// A declaration that already starts with it is left alone, so running it
// twice changes nothing. Part of `npm run build`, after `build:types`;
// check-build.mjs then checks all four outputs.
//
// It writes only under dist/, like write-cjs-package.mjs.
//
// This is a new-design developer script: project header only, no ported-code
// notice.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const engineSrc = join(root, 'src', 'engine');
const engineTypes = [join(root, 'dist', 'engine'), join(root, 'dist', 'cjs', 'engine')];
const MARKER = 'Ported from CAMeL Tools';

const sources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });

/** The source's leading notice block, or `null` when its first line is not the notice. */
export function noticeBlock(text) {
  const lines = text.split('\n');
  if (!lines[0]?.startsWith(`// ${MARKER}`)) return null;
  const block = [];
  for (const line of lines) {
    if (line === '//' || !line.startsWith('//')) break;
    block.push(line);
  }
  return `${block.join('\n')}\n`;
}

let written = 0;
let missing = 0;
for (const src of sources(engineSrc)) {
  const block = noticeBlock(readFileSync(src, 'utf8'));
  if (block === null) continue;
  for (const dir of engineTypes) {
    const dts = join(dir, relative(engineSrc, src)).replace(/\.ts$/u, '.d.ts');
    if (!existsSync(dts)) {
      console.error(`write-dts-notices: ${relative(root, dts)} is missing; run build:cjs and build:types first.`);
      missing += 1;
      continue;
    }
    const text = readFileSync(dts, 'utf8');
    if (text.startsWith(block)) continue;
    writeFileSync(dts, block + text);
    written += 1;
  }
}
console.log(`write-dts-notices: added the ported-code notice to ${written} declaration file(s).`);
process.exit(missing === 0 ? 0 : 1);
