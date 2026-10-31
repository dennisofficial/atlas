#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/06b0868cd9f1f9bab0fb176034cd5d996206647b20d9c30172a3c44e53c98595/contract';
import startContract from '../../snapshots/06b0868cd9f1f9bab0fb176034cd5d996206647b20d9c30172a3c44e53c98595/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/8c06c16b9fa177877b5bb7b893f77c96e2f071c40b5f85bc4e5a4bfd8b0d102a/contract';
import endContract from '../../snapshots/8c06c16b9fa177877b5bb7b893f77c96e2f071c40b5f85bc4e5a4bfd8b0d102a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'Thread',
        column: col('historyRev', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
