#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/002ccde9a04c81afe52c0bdcff59c1f67b359a4488f643ef5bd5b4c3e301e321/contract';
import endContract from '../../snapshots/002ccde9a04c81afe52c0bdcff59c1f67b359a4488f643ef5bd5b4c3e301e321/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c746171405bfe47231db56934b722ceb1571a3839b181bde4cf88a4c8c39b411/contract';
import startContract from '../../snapshots/c746171405bfe47231db56934b722ceb1571a3839b181bde4cf88a4c8c39b411/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('podDesiredDiskGb', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
