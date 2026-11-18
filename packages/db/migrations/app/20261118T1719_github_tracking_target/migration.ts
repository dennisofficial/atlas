#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1add8b8b9f6b1ff3f18634749b5027921128d81a95a5cd7514fa8ae269324f77/contract';
import endContract from '../../snapshots/1add8b8b9f6b1ff3f18634749b5027921128d81a95a5cd7514fa8ae269324f77/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/36a4181aa3c68fd5fc8527922fd3b3412fb0446bbb6367dc3a4d395b8b0d4f28/contract';
import startContract from '../../snapshots/36a4181aa3c68fd5fc8527922fd3b3412fb0446bbb6367dc3a4d395b8b0d4f28/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'GithubTrackingTarget',
        columns: [
          col('branch', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('liveUntil', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('lookedUpAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('prNumber', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('repoFullName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'GithubTrackingTarget_kind_check_3307deca',
            sql`"kind" IN ('head', 'pull-request')`,
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'GithubTrackingTarget',
        constraint: 'GithubTrackingTarget_userId_kind_repoFullName_branch_prNumber_key',
        columns: ['userId', 'kind', 'repoFullName', 'branch', 'prNumber'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubTrackingTarget',
        index: 'GithubTrackingTarget_liveUntil_idx',
        columns: ['liveUntil'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubTrackingTarget',
        index: 'GithubTrackingTarget_repoFullName_branch_idx',
        columns: ['repoFullName', 'branch'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'GithubTrackingTarget',
        foreignKey: {
          name: 'GithubTrackingTarget_userId_fkey',
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
