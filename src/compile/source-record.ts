// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// The Source_Record: the compiler's input description of a database, its
// name, version, source URL, SHA-256 and size, license, credits, disclaimer
// and citation. Every field is required and every string non-empty; `id` is
// lowercase letters, digits and hyphens. The compiler fails closed on a
// database the record does not describe (`compile-database.ts`). The
// Database_Pin's record is `packages/shanisarf-db-msa/source.json`, whose
// `credits` and `citation` are the root NOTICE's text.
//
// This is a new-design file: project header only.

import type { ManifestSource } from '../load/asset-manifest.js';
import { isSha256Hex } from '../load/asset-manifest.js';
import { SourceRecordError } from '../load/errors.js';

/** A Source_Record (`source.json`). Its fields become the Manifest's. */
export type SourceRecord = ManifestSource;

/** The Source_Record's fields, in the order `source.json` writes them. */
export const SOURCE_RECORD_FIELDS = [
  'id',
  'name',
  'version',
  'source',
  'sourceSha256',
  'sourceBytes',
  'license',
  'credits',
  'disclaimer',
  'citation',
] as const;

const ID = /^[a-z0-9-]+$/u;

function fail(field: string, detail: string): never {
  throw new SourceRecordError(`Source_Record ${field} ${detail}`, field);
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    fail(field, 'is not a non-empty string');
  }
  return value;
}

/**
 * The Source_Record in `value` (parsed JSON), validated.
 *
 * @throws {SourceRecordError} naming the first field that is missing,
 *   malformed or unknown.
 */
export function parseSourceRecord(value: unknown): SourceRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('(record)', 'is not a JSON object');
  }
  const r = value as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!(SOURCE_RECORD_FIELDS as readonly string[]).includes(key)) {
      fail(key, 'is not a Source_Record field');
    }
  }
  const id = text(r['id'], 'id');
  if (!ID.test(id)) {
    fail('id', 'is not lowercase letters, digits and hyphens');
  }
  const name = text(r['name'], 'name');
  const version = text(r['version'], 'version');
  const source = text(r['source'], 'source');
  const sourceSha256 = r['sourceSha256'];
  if (!isSha256Hex(sourceSha256)) {
    fail('sourceSha256', 'is not 64 lowercase hex digits');
  }
  const sourceBytes = r['sourceBytes'];
  if (typeof sourceBytes !== 'number' || !Number.isSafeInteger(sourceBytes) || sourceBytes <= 0) {
    fail('sourceBytes', 'is not a positive safe integer');
  }
  const license = r['license'];
  if (typeof license !== 'object' || license === null || Array.isArray(license)) {
    fail('license', 'is not an object');
  }
  const l = license as Record<string, unknown>;
  for (const key of Object.keys(l)) {
    if (key !== 'id' && key !== 'url') {
      fail(`license.${key}`, 'is not a license field');
    }
  }
  return {
    id,
    name,
    version,
    license: { id: text(l['id'], 'license.id'), url: text(l['url'], 'license.url') },
    credits: text(r['credits'], 'credits'),
    disclaimer: text(r['disclaimer'], 'disclaimer'),
    citation: text(r['citation'], 'citation'),
    source,
    sourceSha256,
    sourceBytes,
  };
}
