#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/65d02fc990c733d3676e480ab5bd6af2247c27ad5a181f8083099cecbdf7bf08/contract';
import endContract from '../../snapshots/65d02fc990c733d3676e480ab5bd6af2247c27ad5a181f8083099cecbdf7bf08/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f62273e682f44e7f454ec6d488e54f124e9589e6492c9caab91ba8434fca8f1d/contract';
import startContract from '../../snapshots/f62273e682f44e7f454ec6d488e54f124e9589e6492c9caab91ba8434fca8f1d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey, rawSql } from '@prisma/orm-postgres/migration';

const backfillBlobRefs = rawSql({
  id: 'data.v2-blob-ref-backfill',
  label: 'Backfill V2BlobRef from the $blob hashes referenced in V2Event canonical text',
  operationClass: 'data',
  target: {
    id: 'table.V2BlobRef',
    details: { schema: 'v2', objectType: 'table' as const, name: 'V2BlobRef' },
  },
  precheck: [],
  execute: [
    {
      description: 'Backfill V2BlobRef from V2Event canonical text',
      sql: `INSERT INTO "v2"."V2BlobRef" ("sessionId", "hash")
SELECT DISTINCT t."sessionId", (m."match")[1]
FROM "v2"."V2Event" e
JOIN "v2"."V2Thread" t ON t."id" = e."threadId"
CROSS JOIN LATERAL regexp_matches(e."canonical", '"\\$blob":\\{"hash":"([0-9a-f]{64})"', 'g') AS m("match")
ON CONFLICT DO NOTHING`,
    },
  ],
  postcheck: [],
});

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'v2',
        table: 'V2BlobRef',
        columns: [
          col('hash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['sessionId', 'hash'])],
      }),
      backfillBlobRefs,
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
