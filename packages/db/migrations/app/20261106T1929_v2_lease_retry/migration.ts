#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/85dcc4452034cec7ee4a5b09cd1df11f5ee71c719c5db3a0fc0a9b32ac445c66/contract';
import startContract from '../../snapshots/85dcc4452034cec7ee4a5b09cd1df11f5ee71c719c5db3a0fc0a9b32ac445c66/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/bf1d58bab3431546539e67391d6ef29bb0b5ce7ea1d5de89aa41ab17d18f31f4/contract';
import endContract from '../../snapshots/bf1d58bab3431546539e67391d6ef29bb0b5ce7ea1d5de89aa41ab17d18f31f4/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Lease',
        column: col('attempts', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Lease',
        column: col('retryAfter', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
