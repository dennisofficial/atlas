#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0177afbe1032f67b7454ea77afa20d9c0d29afca2914e1ad06a2604ce3af37e8/contract';
import endContract from '../../snapshots/0177afbe1032f67b7454ea77afa20d9c0d29afca2914e1ad06a2604ce3af37e8/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/fe7026b0bafb2b5365ea4cb7162f26f4060d11115bc29bee8787d1f3d102a2e1/contract';
import startContract from '../../snapshots/fe7026b0bafb2b5365ea4cb7162f26f4060d11115bc29bee8787d1f3d102a2e1/contract.json' with { type: 'json' };
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
      this.dropTable({ schema: 'v2', table: 'V2SessionPullRequest' }),
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
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('liveUntil', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('lookedUpAt', 'timestamptz(3)', {
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
      this.addUnique({
        schema: 'public',
        table: 'GithubTrackingTarget',
        constraint: 'GithubTrackingTarget_userId_kind_repoFullName_branch_prNumber_key',
        columns: ['userId', 'kind', 'repoFullName', 'branch', 'prNumber'],
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
