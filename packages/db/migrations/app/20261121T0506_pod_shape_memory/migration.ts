#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/146b406219be1abe18c62f1a1110703555fc61a7afece7555a592afb45e52c4b/contract';
import startContract from '../../snapshots/146b406219be1abe18c62f1a1110703555fc61a7afece7555a592afb45e52c4b/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f13535a1ebf4df5f3c2aa8979830f5e10f36fe0c7d49cc29dff96003e7be2b09/contract';
import endContract from '../../snapshots/f13535a1ebf4df5f3c2aa8979830f5e10f36fe0c7d49cc29dff96003e7be2b09/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('podActualMemoryGb', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('podDesiredMemoryGb', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
