#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/caebce66b301daa2b9656ec07c05eb8b99897e579769a0b0b2d2d29183f93ed9/contract';
import startContract from '../../snapshots/caebce66b301daa2b9656ec07c05eb8b99897e579769a0b0b2d2d29183f93ed9/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ec7794377e3325dd741a9d5a725424432965809ff130632875c2154e47158890/contract';
import endContract from '../../snapshots/ec7794377e3325dd741a9d5a725424432965809ff130632875c2154e47158890/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, rawSql } from '@prisma/orm-postgres/migration';

const backfillThreadId = rawSql({
  id: 'data.github-subscription-thread-id-backfill',
  label: 'Backfill GithubSubscription.threadId with an empty string for the new unique key',
  operationClass: 'data',
  target: {
    id: 'table.GithubSubscription',
    details: { schema: 'public', objectType: 'table' as const, name: 'GithubSubscription' },
  },
  precheck: [],
  execute: [
    {
      description: 'Backfill GithubSubscription.threadId',
      sql: `UPDATE "public"."GithubSubscription" SET "threadId" = '' WHERE "threadId" IS NULL`,
    },
  ],
  postcheck: [],
});

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      backfillThreadId,
      this.dropConstraint({
        schema: 'public',
        table: 'GithubSubscription',
        constraint: 'GithubSubscription_userId_repoFullName_branch_key',
      }),
      this.setNotNull({ schema: 'public', table: 'GithubSubscription', column: 'threadId' }),
      this.setDefault({
        schema: 'public',
        table: 'GithubSubscription',
        column: col('threadId', 'text', { default: lit(''), codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'GithubSubscription',
        constraint: 'GithubSubscription_userId_repoFullName_branch_threadId_key',
        columns: ['userId', 'repoFullName', 'branch', 'threadId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
