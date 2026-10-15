// shanisarf — Arabic morphological analyzer. Copyright 2026 shani-go
// (https://github.com/shani-go), MIT License.
//
// Unit tests for the Source_Record: a valid record parses, and each missing,
// malformed or unknown field throws `SourceRecordError` naming it. The record
// is invented.

import { describe, expect, it } from 'vitest';

import { DatabaseError } from '../engine/errors.js';
import { AssetError, SourceRecordError } from '../load/errors.js';

import { parseSourceRecord } from './source-record.js';

const RECORD = {
  id: 'invented-db',
  name: 'Invented DB',
  version: '0.1',
  source: 'https://example.invalid/db.txt',
  sourceSha256: 'a'.repeat(64),
  sourceBytes: 1234,
  license: { id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  credits: 'Invented credits.',
  disclaimer: 'Invented disclaimer.',
  citation: 'Invented citation.',
};

function refuses(field: string, change: (r: Record<string, unknown>) => void): void {
  const r = structuredClone(RECORD) as Record<string, unknown>;
  change(r);
  let error: unknown;
  try {
    parseSourceRecord(r);
  } catch (e) {
    error = e;
  }
  expect(error, field).toBeInstanceOf(SourceRecordError);
  expect(error).toBeInstanceOf(AssetError);
  expect(error).toBeInstanceOf(DatabaseError);
  expect((error as SourceRecordError).field).toBe(field);
  expect((error as SourceRecordError).message).toContain(field);
}

describe('parseSourceRecord', () => {
  it('parses a valid record into the Manifest\'s fields', () => {
    expect(parseSourceRecord(RECORD)).toEqual(RECORD);
  });

  it('names a missing or empty field', () => {
    for (const field of ['id', 'name', 'version', 'source', 'credits', 'disclaimer', 'citation']) {
      refuses(field, (r) => delete r[field]);
      refuses(field, (r) => (r[field] = ''));
    }
    refuses('sourceSha256', (r) => delete r['sourceSha256']);
    refuses('sourceBytes', (r) => delete r['sourceBytes']);
    refuses('license', (r) => delete r['license']);
    refuses('license.id', (r) => delete (r['license'] as Record<string, unknown>)['id']);
    refuses('license.url', (r) => ((r['license'] as Record<string, unknown>)['url'] = ''));
  });

  it('names a malformed field', () => {
    refuses('id', (r) => (r['id'] = 'Invented_DB'));
    refuses('sourceSha256', (r) => (r['sourceSha256'] = 'ab'));
    refuses('sourceSha256', (r) => (r['sourceSha256'] = 'A'.repeat(64)));
    refuses('sourceBytes', (r) => (r['sourceBytes'] = -1));
    refuses('sourceBytes', (r) => (r['sourceBytes'] = '1234'));
    refuses('license', (r) => (r['license'] = 'CC0-1.0'));
    refuses('name', (r) => (r['name'] = 42));
  });

  it('names an unknown field', () => {
    refuses('endorsedBy', (r) => (r['endorsedBy'] = 'nobody'));
    refuses('license.text', (r) => ((r['license'] as Record<string, unknown>)['text'] = 'x'));
  });

  it('refuses a value that is not an object', () => {
    for (const value of [null, [], 'x', 3]) {
      expect(() => parseSourceRecord(value)).toThrow(SourceRecordError);
    }
  });
});
