#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2508d2fce685f5a105af81d479e0cb974044a107acbca7a90bbbc3c051f8e2be/contract';
import startContract from '../../snapshots/2508d2fce685f5a105af81d479e0cb974044a107acbca7a90bbbc3c051f8e2be/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/48f388327b7b2ead307be46883590187c4129a53bb4c9912a089979c3a7e0c46/contract';
import endContract from '../../snapshots/48f388327b7b2ead307be46883590187c4129a53bb4c9912a089979c3a7e0c46/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.setDefault({
        schema: 'public',
        table: 'DeviceCode',
        column: col('updatedAt', 'timestamptz(3)', {
          default: fn(sql`now()`),
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
