// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The data package directory: `packages/shanisarf-db-msa/` holds its committed
// files with the fields they must carry; its Source_Record is valid and takes
// `credits` and `citation` from the root NOTICE; its NOTICE carries them too;
// and no file in it, outside the git-ignored `asset/`, has the Database_Pin's
// size or content SHA-256 (the constants are read from the root NOTICE, so the
// pin is not needed).

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseSourceRecord } from '../../src/compile/source-record.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkgDir = join(root, 'packages', 'shanisarf-db-msa');
const rootNotice = readFileSync(join(root, 'NOTICE'), 'utf8');

/** Runs of whitespace as one space, as `NOTICE` wraps and indents. */
const squash = (s: string): string => s.replace(/[ \t\r\n]+/gu, ' ').trim();

/** The Camel Morph MSA section of the root NOTICE. */
const camelSection = rootNotice.slice(rootNotice.indexOf('### Camel Morph MSA v1.0'), rootNotice.indexOf('## Fixture word lists'));
const quoted = (label: string): string => {
  const at = camelSection.indexOf(`- ${label}: `);
  const rest = camelSection.slice(at + label.length + 4);
  const end = rest.search(/\n- |\n\n|\n##/u);
  return squash(end === -1 ? rest : rest.slice(0, end));
};
const NOTICE_CREDITS = quoted('Attribution text').replace(/^"|"$/gu, '');
const NOTICE_CITATION = quoted('Citation');
const PIN_SHA256 = /SHA-256\s+`([0-9a-f]{64})`/u.exec(camelSection)?.[1];
const PIN_BYTES = Number(/\(([\d,]+) bytes\)/u.exec(camelSection)?.[1]?.replaceAll(',', ''));

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return relative(pkgDir, path) === 'asset' ? [] : filesUnder(path);
    }
    return [path];
  });
}

describe('the data package directory', () => {
  it('reads the pin\'s constants and attribution from the root NOTICE', () => {
    expect(PIN_SHA256).toBe('110e03baa282874062d076e23d9671e985b6f76520b891d58cba4e55de0b8f60');
    expect(PIN_BYTES).toBe(84_959_404);
    expect(NOTICE_CREDITS).toMatch(/^Camel Morph MSA v1\.0, developed by the CAMeL Lab at New York University Abu Dhabi \(Khairallah et al\., 2024\), https:\/\/github\.com\/CAMeL-Lab\/camel_morph, .* Adapted \(compiled\) by shanisarf\.$/u);
    expect(NOTICE_CITATION).toMatch(/^Khairallah, Christian, .* https:\/\/aclanthology\.org\/2024\.lrec-main\.240\.pdf$/u);
  });

  it('holds its committed files, and package.json is data only, CC-BY-4.0, private', () => {
    for (const file of ['package.json', 'README.md', 'NOTICE', 'source.json']) {
      expect(statSync(join(pkgDir, file)).isFile(), file).toBe(true);
    }
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg['name']).toBe('shanisarf-db-msa');
    expect(pkg['version']).toMatch(/^1\.0\.\d+$/u);
    expect(pkg['private']).toBe(true);
    expect(pkg['license']).toBe('CC-BY-4.0');
    expect(pkg['files']).toEqual(['asset', 'README.md', 'NOTICE']);
    expect(pkg['exports']).toEqual({ './asset/*': './asset/*', './package.json': './package.json' });
    for (const absent of ['main', 'module', 'types', 'scripts', 'dependencies', 'peerDependencies', 'bin']) {
      expect(pkg, absent).not.toHaveProperty(absent);
    }
    expect(filesUnder(pkgDir).filter((f) => /\.(c|m)?[jt]s$/u.test(f))).toEqual([]);
  });

  it('has a valid Source_Record whose credits and citation are the root NOTICE\'s', () => {
    const record = parseSourceRecord(JSON.parse(readFileSync(join(pkgDir, 'source.json'), 'utf8')));
    expect(record.id).toBe('camel-morph-msa');
    expect(record.sourceSha256).toBe(PIN_SHA256);
    expect(record.sourceBytes).toBe(PIN_BYTES);
    expect(record.license).toEqual({ id: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' });
    expect(squash(record.credits)).toBe(NOTICE_CREDITS);
    expect(squash(record.citation)).toBe(NOTICE_CITATION);
    expect(record.disclaimer).toMatch(/Section 5/u);
    expect(record.disclaimer).toContain('https://creativecommons.org/licenses/by/4.0/legalcode#s5');
    expect(record.disclaimer).toMatch(/nothing in it implies that CAMeL Lab endorses/u);
  });

  it('carries the attribution and citation in its NOTICE and README', () => {
    const notice = squash(readFileSync(join(pkgDir, 'NOTICE'), 'utf8'));
    expect(notice).toContain(NOTICE_CREDITS);
    expect(notice).toContain(NOTICE_CITATION);
    const readme = squash(readFileSync(join(pkgDir, 'README.md'), 'utf8'));
    expect(readme).toContain(NOTICE_CREDITS);
    expect(readme).toContain('https://creativecommons.org/licenses/by/4.0/');
    expect(readme).toMatch(/Nothing here implies that CAMeL Lab endorses/u);
  });

  it('holds no file with the Database_Pin\'s size or content SHA-256, outside the git-ignored asset/', () => {
    const files = filesUnder(pkgDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const bytes = readFileSync(file);
      expect(bytes.length, relative(root, file)).not.toBe(PIN_BYTES);
      expect(createHash('sha256').update(bytes).digest('hex'), relative(root, file)).not.toBe(PIN_SHA256);
    }
  });
});
