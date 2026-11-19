#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0286ec8602a1bd3709199639e2b9ef43150ddc2bda27f43ba7206442e135fd48/contract';
import endContract from '../../snapshots/0286ec8602a1bd3709199639e2b9ef43150ddc2bda27f43ba7206442e135fd48/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e7fb1deef42a9e3691eb5b183a61acfa5e82d3bbef4ba7ee38382a7ac0b3ef3f/contract';
import startContract from '../../snapshots/e7fb1deef42a9e3691eb5b183a61acfa5e82d3bbef4ba7ee38382a7ac0b3ef3f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: col('checksExpected', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
