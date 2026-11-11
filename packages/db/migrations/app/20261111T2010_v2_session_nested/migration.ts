#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/961f0c49535f6d02a64b238b27b09be0595c93386a269e0609d9509917c8f24b/contract';
import endContract from '../../snapshots/961f0c49535f6d02a64b238b27b09be0595c93386a269e0609d9509917c8f24b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/a04df9006767473ac4a56cce0bc21d144268ba24e28d5e1982fc2e71496f36f2/contract';
import startContract from '../../snapshots/a04df9006767473ac4a56cce0bc21d144268ba24e28d5e1982fc2e71496f36f2/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('nested', 'bool', {
          notNull: true,
          default: lit(true),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
