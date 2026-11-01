#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/3bbee15ea729039a843a4a8f048d85ed430d10fddef8805972ff255d857056e3/contract';
import startContract from '../../snapshots/3bbee15ea729039a843a4a8f048d85ed430d10fddef8805972ff255d857056e3/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/caebce66b301daa2b9656ec07c05eb8b99897e579769a0b0b2d2d29183f93ed9/contract';
import endContract from '../../snapshots/caebce66b301daa2b9656ec07c05eb8b99897e579769a0b0b2d2d29183f93ed9/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
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
        table: 'GithubPrHeadCheck',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('firstSeenRunningAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('headSha', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('prNumber', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('repoFullName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('settledAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('verdict', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('verdictEventId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['repoFullName', 'prNumber', 'headSha'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'GithubWebhookInbox',
        columns: [
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('deliveryId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('event', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('processedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('processingError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('receivedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['deliveryId'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubPrEvent',
        column: col('dedupeKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'GithubPrEvent',
        constraint: 'GithubPrEvent_dedupeKey_key',
        columns: ['dedupeKey'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubWebhookInbox',
        index: 'GithubWebhookInbox_processedAt_idx',
        columns: ['processedAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
