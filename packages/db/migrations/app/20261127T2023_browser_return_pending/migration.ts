#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/16728f3bc2230e97bb7643a13fa9505d4e74bff2ae34f3336296bf1e287cef18/contract';
import endContract from '../../snapshots/16728f3bc2230e97bb7643a13fa9505d4e74bff2ae34f3336296bf1e287cef18/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c779b18d69fd0e645aa1ed3e4d552bf07119a0f8e3425748b58e06b81715798b/contract';
import startContract from '../../snapshots/c779b18d69fd0e645aa1ed3e4d552bf07119a0f8e3425748b58e06b81715798b/contract.json' with { type: 'json' };
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
        table: 'BrowserReturnPending',
        columns: [
          col('callbackPath', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('expiresAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('flow', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('port', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('providerUrlSealed', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('state', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('surface', 'text', {
            notNull: true,
            default: lit('web'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('userId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('webPath', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['state'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'BrowserReturnPending',
        index: 'BrowserReturnPending_expiresAt_idx',
        columns: ['expiresAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
