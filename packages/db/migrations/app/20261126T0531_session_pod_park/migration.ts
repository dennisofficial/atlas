#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/8d7bb4c0a917ecd62f0a95660731171b1ffaf8ed69846ad2993cb1b7261082b0/contract';
import startContract from '../../snapshots/8d7bb4c0a917ecd62f0a95660731171b1ffaf8ed69846ad2993cb1b7261082b0/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f25064e86faed013784d2529208762579252965c1faf1494f13e290450bef2eb/contract';
import endContract from '../../snapshots/f25064e86faed013784d2529208762579252965c1faf1494f13e290450bef2eb/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'Session',
        column: col('podParkError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Session',
        column: col('podParkedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
