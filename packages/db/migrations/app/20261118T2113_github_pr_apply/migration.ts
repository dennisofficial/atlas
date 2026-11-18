#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0177afbe1032f67b7454ea77afa20d9c0d29afca2914e1ad06a2604ce3af37e8/contract';
import startContract from '../../snapshots/0177afbe1032f67b7454ea77afa20d9c0d29afca2914e1ad06a2604ce3af37e8/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/440aade754b29db78c71837295de8d12133fae48cc9290e2cb2570999e2a38ba/contract';
import endContract from '../../snapshots/440aade754b29db78c71837295de8d12133fae48cc9290e2cb2570999e2a38ba/contract.json' with { type: 'json' };
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
import { backfillPullUpdatedAt } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'GithubBranchProtection',
        columns: [
          col('baseBranch', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('fetchedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('repoFullName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('requiredContexts', 'text[]', {
            notNull: true,
            default: lit([]),
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
        ],
        constraints: [
          primaryKey(['repoFullName', 'baseBranch']),
          checkExpression(
            'GithubBranchProtection_requiredContexts_elem_not_null_83effcc3',
            sql`array_position("requiredContexts", NULL) IS NULL`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'GithubPrOutbox',
        columns: [
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('dedupeKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('dispatchedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('prNumber', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('repoFullName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: col('baseBranch', 'text', {
          notNull: true,
          default: lit(''),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: col('mergeableBaseRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: col('mergeableHeadSha', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: col('mergeableObservedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: col('pullUpdatedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'GithubPrOutbox',
        constraint: 'GithubPrOutbox_dedupeKey_key',
        columns: ['dedupeKey'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubPrOutbox',
        index: 'GithubPrOutbox_pending_idx',
        columns: ['dispatchedAt', 'createdAt'],
      }),
      backfillPullUpdatedAt,
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
