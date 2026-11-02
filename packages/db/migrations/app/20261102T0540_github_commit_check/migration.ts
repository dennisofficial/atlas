#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/bfe49ff940f6329635e9a44412cf28f85606a57b78b461784714fd97ae950a68/contract';
import startContract from '../../snapshots/bfe49ff940f6329635e9a44412cf28f85606a57b78b461784714fd97ae950a68/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d5e5a2706e61e5fad472ac8388a376b8687daeed64e300ae3ff8330aa637fc5d/contract';
import endContract from '../../snapshots/d5e5a2706e61e5fad472ac8388a376b8687daeed64e300ae3ff8330aa637fc5d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'GithubCommitCheck',
        columns: [
          col('checkKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('headSha', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('outcome', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('repoFullName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sourceUpdatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('startedAt', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['repoFullName', 'headSha', 'checkKey'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubCommitCheck',
        index: 'GithubCommitCheck_updatedAt_idx_8c508b31',
        columns: ['updatedAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
