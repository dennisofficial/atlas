#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/8c06c16b9fa177877b5bb7b893f77c96e2f071c40b5f85bc4e5a4bfd8b0d102a/contract';
import startContract from '../../snapshots/8c06c16b9fa177877b5bb7b893f77c96e2f071c40b5f85bc4e5a4bfd8b0d102a/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/cde231c54cd35e26d3b6411c1e3c575553cc8a4f6cedd8c51db9b4eaf9e15cc0/contract';
import endContract from '../../snapshots/cde231c54cd35e26d3b6411c1e3c575553cc8a4f6cedd8c51db9b4eaf9e15cc0/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'ContextFile',
        columns: [
          col('content', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('digest', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('path', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('threadId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'ContextFile',
        constraint: 'ContextFile_threadId_path_key',
        columns: ['threadId', 'path'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ContextFile',
        foreignKey: {
          name: 'ContextFile_threadId_fkey',
          columns: ['threadId'],
          references: { schema: 'public', table: 'Thread', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
