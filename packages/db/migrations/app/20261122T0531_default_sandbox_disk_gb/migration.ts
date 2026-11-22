#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/027a78bb580bcea4fac8bb1e13e9e3c2ed1ba065836bc46e2fbd208264a5c275/contract';
import endContract from '../../snapshots/027a78bb580bcea4fac8bb1e13e9e3c2ed1ba065836bc46e2fbd208264a5c275/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/41a31a761fa6cd6592e5d4a264897449d932fa00b5c4e72926904248ccde9acb/contract';
import startContract from '../../snapshots/41a31a761fa6cd6592e5d4a264897449d932fa00b5c4e72926904248ccde9acb/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'Project',
        column: col('sandboxDiskGb', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
