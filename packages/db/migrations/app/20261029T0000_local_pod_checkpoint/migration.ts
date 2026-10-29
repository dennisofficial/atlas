#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4dd6b4ae96e6bac6c84a30e83894c3ac0c8f3e48c43a22bcbc5841ee7ce35210/contract';
import startContract from '../../snapshots/4dd6b4ae96e6bac6c84a30e83894c3ac0c8f3e48c43a22bcbc5841ee7ce35210/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/7f695b93d1d4a2c772f2e879418d577eae8e81db8c2850b3a458bdc61f770d9b/contract';
import endContract from '../../snapshots/7f695b93d1d4a2c772f2e879418d577eae8e81db8c2850b3a458bdc61f770d9b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'LocalPodCheckpoint',
        columns: [
          col('checkpoint', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('revision', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('threadId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'LocalPodCheckpoint',
        constraint: 'LocalPodCheckpoint_threadId_key',
        columns: ['threadId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'LocalPodCheckpoint',
        index: 'LocalPodCheckpoint_userId_idx',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'LocalPodCheckpoint',
        foreignKey: {
          name: 'LocalPodCheckpoint_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'LocalPodCheckpoint',
        foreignKey: {
          name: 'LocalPodCheckpoint_threadId_fkey',
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
