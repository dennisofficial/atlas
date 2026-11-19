#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/03c0fe7f2588b74aae34cffb0265f9af9108958a14f20512e7c639a359f1e2cb/contract';
import startContract from '../../snapshots/03c0fe7f2588b74aae34cffb0265f9af9108958a14f20512e7c639a359f1e2cb/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/fcd0e8a3d02428ea66ea8ed6d1f8be1c1e8803014b295892f5940eef1429c933/contract';
import endContract from '../../snapshots/fcd0e8a3d02428ea66ea8ed6d1f8be1c1e8803014b295892f5940eef1429c933/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey, rawSql } from '@prisma/orm-postgres/migration';

const backfillFirstSeenAt = rawSql({
  id: 'data.v2-session-branch-first-seen-at-backfill',
  label: 'Backfill V2SessionBranch.firstSeenAt from the branches-observed event that first saw it',
  operationClass: 'data',
  target: {
    id: 'table.V2SessionBranch',
    details: { schema: 'v2', objectType: 'table' as const, name: 'V2SessionBranch' },
  },
  precheck: [],
  execute: [
    {
      description: 'Backfill V2SessionBranch.firstSeenAt from V2Event.at',
      sql: `UPDATE "v2"."V2SessionBranch" b
SET "firstSeenAt" = seen."at"
FROM (
  SELECT t."sessionId", e."seq", MIN(e."at") AS "at"
  FROM "v2"."V2Event" e
  JOIN "v2"."V2Thread" t ON t."id" = e."threadId"
  WHERE e."type" = 'branches-observed'
  GROUP BY t."sessionId", e."seq"
) seen
WHERE seen."sessionId" = b."sessionId" AND seen."seq" = b."firstSeenSeq" AND b."firstSeenAt" IS NULL`,
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
        table: 'V2SessionPullRequest',
        columns: [
          col('prNumber', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('repoFullName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['sessionId', 'repoFullName', 'prNumber'])],
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2SessionBranch',
        column: col('firstSeenAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      backfillFirstSeenAt,
      this.createIndex({
        schema: 'v2',
        table: 'V2SessionPullRequest',
        index: 'V2SessionPullRequest_repoFullName_prNumber_idx_af81cccf',
        columns: ['repoFullName', 'prNumber'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2SessionPullRequest',
        index: 'V2SessionPullRequest_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.addForeignKey({
        schema: 'v2',
        table: 'V2SessionPullRequest',
        foreignKey: {
          name: 'V2SessionPullRequest_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'v2', table: 'V2Session', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
