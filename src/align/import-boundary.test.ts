// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The import boundary. Reads the source files' static and dynamic import
// specifiers and walks the graphs: the engine's public entry reaches nothing
// under src/align/, src/worker/ or src/load/; every module under src/align/
// imports only engine modules; and the engine entry and both package-root
// entries export the alignment surface.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as align from './index.js';
import * as engine from '../engine/index.js';
import * as rootBrowser from '../index.js';
import * as rootNode from '../index-node.js';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (file: string): string => relative(srcDir, file).split('\\').join('/');

/** Drop block comments and whole-line comments, so a specifier in prose is not read. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

/** The import and re-export specifiers of a source file, type-only ones included. */
function specifiersOf(text: string): string[] {
  const code = stripComments(text);
  const out: string[] = [];
  const patterns = [
    /\b(?:import|export)\b[^;'"`]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) {
      const spec = m[1];
      if (spec !== undefined) out.push(spec);
    }
  }
  return out;
}

/** A relative `.js` specifier resolved to its `.ts` source; `null` for a bare one. */
function resolveSpec(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  return resolve(dirname(from), spec).replace(/\.js$/, '.ts');
}

/** Every source file the entry's graph reaches, and every bare specifier on the way. */
function graph(entry: string): { files: Set<string>; bare: Set<string> } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const todo = [entry];
  while (todo.length > 0) {
    const file = todo.pop();
    if (file === undefined || files.has(file)) continue;
    files.add(file);
    for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
      const target = resolveSpec(file, spec);
      if (target === null) bare.add(spec);
      else todo.push(target);
    }
  }
  return { files, bare };
}

describe('the import boundary', () => {
  it('reads specifiers across lines, type-only, re-exports and dynamic imports, but not comments', () => {
    const text = [
      "import type { A } from './a.js';",
      'import {',
      '  B,',
      "} from './b.js';",
      "export * from './c.js';",
      "// import { Z } from './z.js';",
      "/* export { Y } from './y.js'; */",
      "const m = await import('./d.js');",
      "import './e.js';",
    ].join('\n');
    expect(specifiersOf(text).sort()).toEqual(['./a.js', './b.js', './c.js', './d.js', './e.js']);
  });

  it('the engine entry reaches nothing under src/align/, src/worker/ or src/load/', () => {
    const { files, bare } = graph(join(srcDir, 'engine/index.ts'));
    const reached = [...files].map(rel);
    expect(reached).toContain('engine/lexicon.ts');
    expect(reached).toContain('engine/key-fold.ts');
    const outside = reached.filter((f) => !f.startsWith('engine/'));
    expect(outside).toEqual([]);
    expect(reached.filter((f) => /^(?:align|worker|load)\//.test(f))).toEqual([]);
    expect([...bare]).toEqual([]);
  });

  it('every module under src/align/ imports only engine modules', () => {
    const modules = readdirSync(join(srcDir, 'align'))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => join(srcDir, 'align', name));
    expect(modules.map(rel)).toContain('align/index.ts');
    for (const file of modules) {
      for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
        const target = resolveSpec(file, spec);
        expect(target, `${rel(file)} imports ${spec}`).not.toBeNull();
        const where = rel(target ?? '');
        const ok = where.startsWith('engine/') || (where.startsWith('align/') && !where.endsWith('.test.ts'));
        expect(ok, `${rel(file)} imports ${where}`).toBe(true);
      }
    }
    // The alignment graph, followed through, reaches only src/align/ and src/engine/.
    const { files, bare } = graph(join(srcDir, 'align/index.ts'));
    expect([...files].map(rel).filter((f) => !/^(?:align|engine)\//.test(f))).toEqual([]);
    expect([...bare]).toEqual([]);
  });
});

describe('the exported surface', () => {
  it('the engine entry exports stripLex, foldArabicKey and Lexicon, and not the test-facing reader', () => {
    expect(typeof engine.stripLex).toBe('function');
    expect(typeof engine.foldArabicKey).toBe('function');
    expect(typeof engine.Lexicon).toBe('function');
    expect('lexiconIndexesOf' in engine).toBe(false);
    expect('entryMemoOf' in engine).toBe(false);
    expect('cliticSegments' in engine).toBe(false);
  });

  it('the alignment surface exports cliticSegments, placeMarks and agreedMarks', () => {
    expect(Object.keys(align).sort()).toEqual(['agreedMarks', 'cliticSegments', 'placeMarks']);
  });

  it('the types are reachable from the engine entry, the alignment surface and the package root', () => {
    const key: engine.LookupKey = 'root';
    const options: engine.LookupOptions = { fold: true };
    const entry: engine.LexiconEntry | null = null;
    const role: align.CliticRole = 'stem';
    const segment: align.CliticSegment = { role, text: '' };
    const segOptions: align.CliticSegmentsOptions = { scheme: 'd3seg' };
    const rootKey: rootBrowser.LookupKey = key;
    const rootSegment: rootNode.CliticSegment = segment;
    expect([key, options.fold, entry, segment.role, segOptions.scheme, rootKey, rootSegment.text]).toEqual([
      'root',
      true,
      null,
      'stem',
      'd3seg',
      'root',
      '',
    ]);
  });

  it('both package-root entries re-export the engine and the alignment surface', () => {
    for (const root of [rootBrowser, rootNode] as Record<string, unknown>[]) {
      for (const name of ['cliticSegments', 'placeMarks', 'agreedMarks'] as const) {
        expect(root[name]).toBe(align[name]);
      }
      for (const name of ['stripLex', 'foldArabicKey', 'Lexicon'] as const) {
        expect(root[name]).toBe(engine[name]);
      }
      expect(typeof root['loadDatabase']).toBe('function');
    }
  });
});
