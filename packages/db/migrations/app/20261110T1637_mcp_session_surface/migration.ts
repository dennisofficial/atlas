#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/16fc818c1490fd04ea35cb9a949f3280daae90ebb67a43d77ac7ce33dd3c6899/contract';
import startContract from '../../snapshots/16fc818c1490fd04ea35cb9a949f3280daae90ebb67a43d77ac7ce33dd3c6899/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/419b73dd7ccf410f5f3dca1e6722d5d82ea53438cce0aa3929fb0d7cec776664/contract';
import endContract from '../../snapshots/419b73dd7ccf410f5f3dca1e6722d5d82ea53438cce0aa3929fb0d7cec776664/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('lastSurface', 'text', {
          notNull: true,
          default: lit('web'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
