#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/4c20296055e46c200195d3e5c6134aa23dd16623d5cb98ceaca13559ece29d7d/contract';
import endContract from '../../snapshots/4c20296055e46c200195d3e5c6134aa23dd16623d5cb98ceaca13559ece29d7d/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/8c06c16b9fa177877b5bb7b893f77c96e2f071c40b5f85bc4e5a4bfd8b0d102a/contract';
import startContract from '../../snapshots/8c06c16b9fa177877b5bb7b893f77c96e2f071c40b5f85bc4e5a4bfd8b0d102a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'ComposerDraft',
        columns: [
          col('attachments', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('scopeKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('text', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('threadId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['userId', 'scopeKey'], { name: 'ComposerDraft_pkey' })],
      }),
      this.createIndex({
        schema: 'public',
        table: 'ComposerDraft',
        index: 'ComposerDraft_threadId_idx',
        columns: ['threadId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ComposerDraft',
        foreignKey: {
          name: 'ComposerDraft_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ComposerDraft',
        foreignKey: {
          name: 'ComposerDraft_threadId_fkey',
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
