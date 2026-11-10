#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1440ea06adc82bfb24c1b7d40dc3fc4a31df6691444f3237fb72c7a072b29df7/contract';
import startContract from '../../snapshots/1440ea06adc82bfb24c1b7d40dc3fc4a31df6691444f3237fb72c7a072b29df7/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/fa3eeff401780a4f24dc6679022b22033181cc05d84b4cd2f483a41337134f2c/contract';
import endContract from '../../snapshots/fa3eeff401780a4f24dc6679022b22033181cc05d84b4cd2f483a41337134f2c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'CloudSandbox',
        column: col('retiredAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
