#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1a02b03e9c55a9217a656178deaf1e9cd859f579ee855b15801ba04a1329bbbc/contract';
import endContract from '../../snapshots/1a02b03e9c55a9217a656178deaf1e9cd859f579ee855b15801ba04a1329bbbc/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/dfcc7c0b326bdd3a18c3406fcad8c05ea65a610165757e8832bd973b236fdf92/contract';
import startContract from '../../snapshots/dfcc7c0b326bdd3a18c3406fcad8c05ea65a610165757e8832bd973b236fdf92/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';
import { backfillUserActive } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'User',
        column: col('active', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      backfillUserActive,
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
