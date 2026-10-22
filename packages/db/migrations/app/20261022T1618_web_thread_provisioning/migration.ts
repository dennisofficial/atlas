#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/48f388327b7b2ead307be46883590187c4129a53bb4c9912a089979c3a7e0c46/contract';
import startContract from '../../snapshots/48f388327b7b2ead307be46883590187c4129a53bb4c9912a089979c3a7e0c46/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/652eda18865caeb7c4d12898fc475837af9bfedf38aed15cb3f1041db4729364/contract';
import endContract from '../../snapshots/652eda18865caeb7c4d12898fc475837af9bfedf38aed15cb3f1041db4729364/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';
import { backfillThreadOwner } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'SandboxBootStep',
        columns: [
          col('at', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('error', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('state', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('step', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('threadId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'UserVercelCredential',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('sealedToken', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('teamId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('vercelProjectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['userId'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'Thread',
        column: col('organizationId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      backfillThreadOwner,
      this.addColumn({
        schema: 'public',
        table: 'WorkspaceVercelCredential',
        column: col('vercelProjectId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'SandboxBootStep',
        index: 'SandboxBootStep_threadId_at_idx',
        columns: ['threadId', 'at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Thread',
        index: 'Thread_organizationId_idx',
        columns: ['organizationId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'SandboxBootStep',
        foreignKey: {
          name: 'SandboxBootStep_threadId_fkey',
          columns: ['threadId'],
          references: { schema: 'public', table: 'Thread', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Thread',
        foreignKey: {
          name: 'Thread_organizationId_fkey',
          columns: ['organizationId'],
          references: { schema: 'public', table: 'Organization', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'UserVercelCredential',
        foreignKey: {
          name: 'UserVercelCredential_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
