#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/04bc31236a81dff5e209b163f3961960d73bc56f23b5f7453ebc8f10d2a0605f/contract';
import startContract from '../../snapshots/04bc31236a81dff5e209b163f3961960d73bc56f23b5f7453ebc8f10d2a0605f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/4a7a57f07ec50876323470f922e0a33d7f89707c70d7f6e8e91c38cc52875f71/contract';
import endContract from '../../snapshots/4a7a57f07ec50876323470f922e0a33d7f89707c70d7f6e8e91c38cc52875f71/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, sql } from '@prisma/orm-postgres/migration';
import { backfillNextDueAt } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubTrackingTarget',
        column: col('failures', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubTrackingTarget',
        column: col('leaseUntil', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubTrackingTarget',
        column: col('nextDueAt', 'timestamptz(3)', {
          notNull: true,
          default: fn(sql`now()`),
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      backfillNextDueAt,
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
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
