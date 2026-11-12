#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/18cc19217e93f293fdf4ead552006ed88ffce456a96e38ed4a5147a8e6fc8912/contract';
import startContract from '../../snapshots/18cc19217e93f293fdf4ead552006ed88ffce456a96e38ed4a5147a8e6fc8912/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c6031259b2791244b5c7e8e2ee815047f27ee8417bdde6394dc7ad25e9fa3211/contract';
import endContract from '../../snapshots/c6031259b2791244b5c7e8e2ee815047f27ee8417bdde6394dc7ad25e9fa3211/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'v2',
        table: 'V2OperatorRequest',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('expiresAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('prompt', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('resolvedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('secret', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('shellId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('threadId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2OperatorRequest',
        index: 'V2OperatorRequest_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2OperatorRequest',
        index: 'V2OperatorRequest_status_expiresAt_idx_c206f415',
        columns: ['status', 'expiresAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
