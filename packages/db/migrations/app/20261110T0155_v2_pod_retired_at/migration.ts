#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/16fc818c1490fd04ea35cb9a949f3280daae90ebb67a43d77ac7ce33dd3c6899/contract';
import endContract from '../../snapshots/16fc818c1490fd04ea35cb9a949f3280daae90ebb67a43d77ac7ce33dd3c6899/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/fa3eeff401780a4f24dc6679022b22033181cc05d84b4cd2f483a41337134f2c/contract';
import startContract from '../../snapshots/fa3eeff401780a4f24dc6679022b22033181cc05d84b4cd2f483a41337134f2c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('podRetiredAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
