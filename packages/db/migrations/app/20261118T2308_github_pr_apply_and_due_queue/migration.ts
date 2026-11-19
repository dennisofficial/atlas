#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/03c0fe7f2588b74aae34cffb0265f9af9108958a14f20512e7c639a359f1e2cb/contract';
import endContract from '../../snapshots/03c0fe7f2588b74aae34cffb0265f9af9108958a14f20512e7c639a359f1e2cb/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b880c65f607b166b6d4bc082fb39f8fbf8db741dd330ddafee93a35a0f7c01c0/contract';
import startContract from '../../snapshots/b880c65f607b166b6d4bc082fb39f8fbf8db741dd330ddafee93a35a0f7c01c0/contract.json' with { type: 'json' };
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
import { backfillNextDueAt } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'GithubPrState',
        constraint: 'GithubPrState_requiredCheckContexts_elem_not_null_eafd55ca',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: 'requiredCheckContexts',
      }),
      this.dropTable({ schema: 'v2', table: 'V2SessionPullRequest' }),
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
          col('deadLetteredAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('dedupeKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('dispatchedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('leaseOwner', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('leaseUntil', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('nextAttemptAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('parkedSince', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('payload', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('prNumber', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('repoFullName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'GithubTrackingTarget',
        columns: [
          col('attemptedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
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
          col('failures', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('leaseToken', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('leaseUntil', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('liveUntil', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('lookedUpAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('nextDueAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('prNumber', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
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
      this.createTable({
        schema: 'v2',
        table: 'V2SessionBranch',
        columns: [
          col('branch', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('firstSeenSeq', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('headRepo', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['sessionId', 'headRepo', 'branch'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubCommitCheck',
        column: col('sourceId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
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
        column: col('closedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
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
        column: col('mergedAt', 'timestamptz(3)', {
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
      backfillNextDueAt,
      this.addUnique({
        schema: 'public',
        table: 'GithubPrOutbox',
        constraint: 'GithubPrOutbox_dedupeKey_key',
        columns: ['dedupeKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'GithubTrackingTarget',
        constraint: 'GithubTrackingTarget_userId_kind_repoFullName_branch_prNumber_key',
        columns: ['userId', 'kind', 'repoFullName', 'branch', 'prNumber'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubPrOutbox',
        index: 'GithubPrOutbox_pending_idx',
        columns: ['dispatchedAt', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubPrState',
        index: 'GithubPrState_headRepoFullName_headBranch_idx_ce47a3ad',
        columns: ['headRepoFullName', 'headBranch'],
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
        index: 'GithubTrackingTarget_liveUntil_nextDueAt_idx',
        columns: ['liveUntil', 'nextDueAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubTrackingTarget',
        index: 'GithubTrackingTarget_nextDueAt_idx',
        columns: ['nextDueAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubTrackingTarget',
        index: 'GithubTrackingTarget_repoFullName_branch_idx',
        columns: ['repoFullName', 'branch'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2SessionBranch',
        index: 'V2SessionBranch_headRepo_branch_idx_2f926fb3',
        columns: ['headRepo', 'branch'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2SessionBranch',
        index: 'V2SessionBranch_sessionId_idx_29f415d4',
        columns: ['sessionId'],
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
      this.addForeignKey({
        schema: 'v2',
        table: 'V2SessionBranch',
        foreignKey: {
          name: 'V2SessionBranch_sessionId_fkey',
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
