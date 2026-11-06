#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/367f086b8ddb99bd89844b81e34832f7646b1c9538a860aa325459c59b3f3d84/contract';
import endContract from '../../snapshots/367f086b8ddb99bd89844b81e34832f7646b1c9538a860aa325459c59b3f3d84/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/bf1d58bab3431546539e67391d6ef29bb0b5ce7ea1d5de89aa41ab17d18f31f4/contract';
import startContract from '../../snapshots/bf1d58bab3431546539e67391d6ef29bb0b5ce7ea1d5de89aa41ab17d18f31f4/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'v2',
        table: 'Media',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('hash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('height', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('mediaType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('size', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('width', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['userId', 'hash'])],
      }),
      this.createTable({
        schema: 'v2',
        table: 'MediaSigningWindow',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('sealed', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('validUntil', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('windowStart', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['windowStart'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
