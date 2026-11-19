#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/dfcc7c0b326bdd3a18c3406fcad8c05ea65a610165757e8832bd973b236fdf92/contract';
import startContract from '../../snapshots/dfcc7c0b326bdd3a18c3406fcad8c05ea65a610165757e8832bd973b236fdf92/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e7fb1deef42a9e3691eb5b183a61acfa5e82d3bbef4ba7ee38382a7ac0b3ef3f/contract';
import endContract from '../../snapshots/e7fb1deef42a9e3691eb5b183a61acfa5e82d3bbef4ba7ee38382a7ac0b3ef3f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('readSeq', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
