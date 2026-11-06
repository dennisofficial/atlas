#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4ee46c5fd44c6032a6b2da39abbe149828438e06f5b1f9adf3b3ada3e7fe7c36/contract';
import startContract from '../../snapshots/4ee46c5fd44c6032a6b2da39abbe149828438e06f5b1f9adf3b3ada3e7fe7c36/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/85dcc4452034cec7ee4a5b09cd1df11f5ee71c719c5db3a0fc0a9b32ac445c66/contract';
import endContract from '../../snapshots/85dcc4452034cec7ee4a5b09cd1df11f5ee71c719c5db3a0fc0a9b32ac445c66/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('archivedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
