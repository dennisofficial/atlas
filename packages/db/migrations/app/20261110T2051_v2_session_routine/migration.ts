#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/3e13111b52f735f29ef70ebcfa0815829a41fd9e122e69ac9b00ada6f90e27b8/contract';
import endContract from '../../snapshots/3e13111b52f735f29ef70ebcfa0815829a41fd9e122e69ac9b00ada6f90e27b8/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/43d6199d8535e370ff8adfa29c80cb268a6c59c8f8a659ba7c1881af231aaa1f/contract';
import startContract from '../../snapshots/43d6199d8535e370ff8adfa29c80cb268a6c59c8f8a659ba7c1881af231aaa1f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('routineId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
