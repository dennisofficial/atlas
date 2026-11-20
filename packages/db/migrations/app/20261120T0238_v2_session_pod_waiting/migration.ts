#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/47438aeb553b3ddbb60cfc40385b576cfe9ad65d699dfcb1063c5ca3f661d657/contract';
import startContract from '../../snapshots/47438aeb553b3ddbb60cfc40385b576cfe9ad65d699dfcb1063c5ca3f661d657/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/65e8ab17771d5cf4f5d0a9493da0d7d329095a90a570b74cf08d3bbb317f390d/contract';
import endContract from '../../snapshots/65e8ab17771d5cf4f5d0a9493da0d7d329095a90a570b74cf08d3bbb317f390d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('podWaitingSince', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
