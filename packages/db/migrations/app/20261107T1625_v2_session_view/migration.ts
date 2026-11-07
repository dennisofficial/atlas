#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/3cee99d03ca9d56e0df37d3506d1cbb4066c6b0fdcf1859dd5ef45b20e50cc5e/contract';
import endContract from '../../snapshots/3cee99d03ca9d56e0df37d3506d1cbb4066c6b0fdcf1859dd5ef45b20e50cc5e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/88da44e40f871a45304a595208c1647379c125fc649092756d0091e8c48dc658/contract';
import startContract from '../../snapshots/88da44e40f871a45304a595208c1647379c125fc649092756d0091e8c48dc658/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'v2',
        table: 'V2SessionPullRequest',
        columns: [
          col('number', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('repo', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['sessionId', 'repo', 'number'])],
      }),
      this.createTable({
        schema: 'v2',
        table: 'V2SessionView',
        columns: [
          col('atSeq', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('state', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('threadId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('version', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['sessionId'])],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2SessionPullRequest',
        index: 'V2SessionPullRequest_repo_number_idx_1b5d84e4',
        columns: ['repo', 'number'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2SessionPullRequest',
        index: 'V2SessionPullRequest_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.addForeignKey({
        schema: 'v2',
        table: 'V2SessionPullRequest',
        foreignKey: {
          name: 'V2SessionPullRequest_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'v2', table: 'V2Session', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'v2',
        table: 'V2SessionView',
        foreignKey: {
          name: 'V2SessionView_sessionId_fkey',
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
