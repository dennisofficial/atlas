#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/3cee99d03ca9d56e0df37d3506d1cbb4066c6b0fdcf1859dd5ef45b20e50cc5e/contract';
import startContract from '../../snapshots/3cee99d03ca9d56e0df37d3506d1cbb4066c6b0fdcf1859dd5ef45b20e50cc5e/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/7d575a2f90a2bd1fc58e196fe37784b57392947281b09cba18ca680cb3714c04/contract';
import endContract from '../../snapshots/7d575a2f90a2bd1fc58e196fe37784b57392947281b09cba18ca680cb3714c04/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('modelEffort', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('modelFast', 'bool', { codecRef: { codecId: 'pg/bool@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('modelRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
