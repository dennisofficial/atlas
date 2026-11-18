#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/36a4181aa3c68fd5fc8527922fd3b3412fb0446bbb6367dc3a4d395b8b0d4f28/contract';
import endContract from '../../snapshots/36a4181aa3c68fd5fc8527922fd3b3412fb0446bbb6367dc3a4d395b8b0d4f28/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e10afd6f04a655c4be2c0eafdcb177d67f2441abf67ede2e9888844edd9e68ef/contract';
import startContract from '../../snapshots/e10afd6f04a655c4be2c0eafdcb177d67f2441abf67ede2e9888844edd9e68ef/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropTable({ schema: 'v2', table: 'V2SessionPullRequest' }),
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
      this.createIndex({
        schema: 'public',
        table: 'GithubPrState',
        index: 'GithubPrState_headRepoFullName_headBranch_idx_ce47a3ad',
        columns: ['headRepoFullName', 'headBranch'],
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
