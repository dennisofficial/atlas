#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5f6ba3b9a87739af644f00c807db2de56d9da1d4d40cb7abcee4b41cc847463d/contract';
import startContract from '../../snapshots/5f6ba3b9a87739af644f00c807db2de56d9da1d4d40cb7abcee4b41cc847463d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f27c2c777ba8a78dc52b2ee934d8bf7ef5b1c6474776a4f95e00210b8418c4f9/contract';
import endContract from '../../snapshots/f27c2c777ba8a78dc52b2ee934d8bf7ef5b1c6474776a4f95e00210b8418c4f9/contract.json' with { type: 'json' };
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
