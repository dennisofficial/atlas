#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/17fdd443010a9232bdff773e7dd760e7c05cba76ae897be0dcaba4f49b8006ec/contract';
import endContract from '../../snapshots/17fdd443010a9232bdff773e7dd760e7c05cba76ae897be0dcaba4f49b8006ec/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/797903f7d98c5c4990d8f823d9aaffd5af00b717b65716135c2d3f0e1be7afe7/contract';
import startContract from '../../snapshots/797903f7d98c5c4990d8f823d9aaffd5af00b717b65716135c2d3f0e1be7afe7/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'v2',
        table: 'V2ContextFile',
        columns: [
          col('digest', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mime', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mtimeMs', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
          col('path', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('size', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'v2',
        table: 'V2ContextFile',
        constraint: 'V2ContextFile_sessionId_path_key',
        columns: ['sessionId', 'path'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2ContextFile',
        index: 'V2ContextFile_digest_idx_5bd527a1',
        columns: ['digest'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2ContextFile',
        index: 'V2ContextFile_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.addForeignKey({
        schema: 'v2',
        table: 'V2ContextFile',
        foreignKey: {
          name: 'V2ContextFile_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'v2', table: 'V2Session', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
