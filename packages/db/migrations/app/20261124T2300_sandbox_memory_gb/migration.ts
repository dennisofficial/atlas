#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/cc41152adc40314d3a65a4dcfa9f1377281450f71fae9b89d6dc22eb6b0cec30/contract';
import endContract from '../../snapshots/cc41152adc40314d3a65a4dcfa9f1377281450f71fae9b89d6dc22eb6b0cec30/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f14deed4b0f53291f5db262e9f79d1b19487fd654b4842787af371390390c4bd/contract';
import startContract from '../../snapshots/f14deed4b0f53291f5db262e9f79d1b19487fd654b4842787af371390390c4bd/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'Project',
        column: col('sandboxMemoryGb', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
