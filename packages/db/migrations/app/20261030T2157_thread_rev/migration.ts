#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/05c8abbf9c944bf7ffa3662999f668ff77b0692a3187973586edcce69da73a19/contract';
import startContract from '../../snapshots/05c8abbf9c944bf7ffa3662999f668ff77b0692a3187973586edcce69da73a19/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/4b5d5fb3abed299fe965f5bf71317327a7c4b3efd12ffb9627bd08d3946a8be9/contract';
import endContract from '../../snapshots/4b5d5fb3abed299fe965f5bf71317327a7c4b3efd12ffb9627bd08d3946a8be9/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'Thread',
        column: col('rev', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
