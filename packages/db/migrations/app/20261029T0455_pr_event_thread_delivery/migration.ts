#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/59978259fa36ad6e18bf185c0a2e0e301f7ba9360c039132c9ff29c46426245b/contract';
import endContract from '../../snapshots/59978259fa36ad6e18bf185c0a2e0e301f7ba9360c039132c9ff29c46426245b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/946def7626177495469475dd9a426226c7de44f7e8e71d88ab4574016887bcdb/contract';
import startContract from '../../snapshots/946def7626177495469475dd9a426226c7de44f7e8e71d88ab4574016887bcdb/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropConstraint({
        schema: 'public',
        table: 'GithubSubscription',
        constraint: 'GithubSubscription_threadId_fkey',
        kind: 'foreignKey',
      }),
      this.createTable({
        schema: 'public',
        table: 'GithubPrEventDelivery',
        columns: [
          col('deliveredAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('eventId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('threadId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['eventId', 'threadId'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubPrEventDelivery',
        index: 'GithubPrEventDelivery_eventId_idx_6a266d47',
        columns: ['eventId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubPrEventDelivery',
        index: 'GithubPrEventDelivery_threadId_idx',
        columns: ['threadId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'GithubPrEventDelivery',
        foreignKey: {
          name: 'GithubPrEventDelivery_eventId_fkey',
          columns: ['eventId'],
          references: { schema: 'public', table: 'GithubPrEvent', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
