#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/dfcc7c0b326bdd3a18c3406fcad8c05ea65a610165757e8832bd973b236fdf92/contract';
import endContract from '../../snapshots/dfcc7c0b326bdd3a18c3406fcad8c05ea65a610165757e8832bd973b236fdf92/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/fcd0e8a3d02428ea66ea8ed6d1f8be1c1e8803014b295892f5940eef1429c933/contract';
import startContract from '../../snapshots/fcd0e8a3d02428ea66ea8ed6d1f8be1c1e8803014b295892f5940eef1429c933/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'v2',
        table: 'V2Terminal',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('endedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('endedReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('exitCode', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ordinal', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('signal', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('state', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('terminalId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['sessionId', 'terminalId']),
          checkExpression(
            'V2Terminal_state_check_5a2da7a7',
            sql`"state" IN ('opening', 'open', 'ended')`,
          ),
        ],
      }),
      this.addUnique({
        schema: 'v2',
        table: 'V2Terminal',
        constraint: 'V2Terminal_sessionId_ordinal_key',
        columns: ['sessionId', 'ordinal'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2Terminal',
        index: 'V2Terminal_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.addForeignKey({
        schema: 'v2',
        table: 'V2Terminal',
        foreignKey: {
          name: 'V2Terminal_sessionId_fkey',
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
