#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/797903f7d98c5c4990d8f823d9aaffd5af00b717b65716135c2d3f0e1be7afe7/contract';
import endContract from '../../snapshots/797903f7d98c5c4990d8f823d9aaffd5af00b717b65716135c2d3f0e1be7afe7/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c91251b96f41b44ec86962b7178768299cbda52cddd9ab9e30e48129525459d7/contract';
import startContract from '../../snapshots/c91251b96f41b44ec86962b7178768299cbda52cddd9ab9e30e48129525459d7/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'v2',
        table: 'V2DiagramRepair',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('modelRef', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('repaired', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['sessionId', 'sourceHash'])],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2DiagramRepair',
        index: 'V2DiagramRepair_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.addForeignKey({
        schema: 'v2',
        table: 'V2DiagramRepair',
        foreignKey: {
          name: 'V2DiagramRepair_sessionId_fkey',
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
