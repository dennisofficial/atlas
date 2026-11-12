#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1143c80ee8dbac2b5a381aa19f5806cfa71c9c3de8e53ffb5f82bd8eef4d80e1/contract';
import startContract from '../../snapshots/1143c80ee8dbac2b5a381aa19f5806cfa71c9c3de8e53ffb5f82bd8eef4d80e1/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/18cc19217e93f293fdf4ead552006ed88ffce456a96e38ed4a5147a8e6fc8912/contract';
import endContract from '../../snapshots/18cc19217e93f293fdf4ead552006ed88ffce456a96e38ed4a5147a8e6fc8912/contract.json' with { type: 'json' };
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
