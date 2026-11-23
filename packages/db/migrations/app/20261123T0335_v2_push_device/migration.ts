#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/3e34f4cf3a0384ac6ed67d1108e74534a33a20a41f7eecd38f6c47c64598ef94/contract';
import startContract from '../../snapshots/3e34f4cf3a0384ac6ed67d1108e74534a33a20a41f7eecd38f6c47c64598ef94/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/5f6ba3b9a87739af644f00c807db2de56d9da1d4d40cb7abcee4b41cc847463d/contract';
import endContract from '../../snapshots/5f6ba3b9a87739af644f00c807db2de56d9da1d4d40cb7abcee4b41cc847463d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'v2',
        table: 'V2PushDevice',
        columns: [
          col('clientId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('disabledAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('secret', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('token', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'v2',
        table: 'V2PushDevice',
        constraint: 'V2PushDevice_token_key',
        columns: ['token'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2PushDevice',
        index: 'V2PushDevice_userId_idx_a489d58a',
        columns: ['userId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
