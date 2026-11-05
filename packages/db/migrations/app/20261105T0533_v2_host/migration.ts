#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/90a3934f5cbc3a945710f8efd4dea6beaa9df0440ddd84f4888e89b711a00e4d/contract';
import endContract from '../../snapshots/90a3934f5cbc3a945710f8efd4dea6beaa9df0440ddd84f4888e89b711a00e4d/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/9865c08ee43a57502ce30d8b837cb2a0804e8ee760f59f39d85758b15b4121fb/contract';
import startContract from '../../snapshots/9865c08ee43a57502ce30d8b837cb2a0804e8ee760f59f39d85758b15b4121fb/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'v2',
        table: 'V2Host',
        columns: [
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
