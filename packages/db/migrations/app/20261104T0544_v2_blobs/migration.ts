#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/c6274268faee4d3d652622919270c0984d8ec8c5d589c4774061dd813f11fa97/contract';
import startContract from '../../snapshots/c6274268faee4d3d652622919270c0984d8ec8c5d589c4774061dd813f11fa97/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f62273e682f44e7f454ec6d488e54f124e9589e6492c9caab91ba8434fca8f1d/contract';
import endContract from '../../snapshots/f62273e682f44e7f454ec6d488e54f124e9589e6492c9caab91ba8434fca8f1d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'v2',
        table: 'V2Blob',
        columns: [
          col('bytes', 'bytea', { notNull: true, codecRef: { codecId: 'pg/bytea@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('hash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('size', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['hash'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
