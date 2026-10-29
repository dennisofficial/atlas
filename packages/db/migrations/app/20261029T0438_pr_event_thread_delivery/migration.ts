#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5d7020556e9c3987cab7c7f2ceffb6c1df259d50993d2a50155c9d63d77a6a8b/contract';
import endContract from '../../snapshots/5d7020556e9c3987cab7c7f2ceffb6c1df259d50993d2a50155c9d63d77a6a8b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b4d2e89e8a65765912a017f22242339633a03efa5531d3746c5d99550a240aab/contract';
import startContract from '../../snapshots/b4d2e89e8a65765912a017f22242339633a03efa5531d3746c5d99550a240aab/contract.json' with { type: 'json' };
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
