#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4c20296055e46c200195d3e5c6134aa23dd16623d5cb98ceaca13559ece29d7d/contract';
import startContract from '../../snapshots/4c20296055e46c200195d3e5c6134aa23dd16623d5cb98ceaca13559ece29d7d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/72a4fc277c7232110726a3363cb7622f7be63fc3f17c5f520460010f70357979/contract';
import endContract from '../../snapshots/72a4fc277c7232110726a3363cb7622f7be63fc3f17c5f520460010f70357979/contract.json' with { type: 'json' };
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
