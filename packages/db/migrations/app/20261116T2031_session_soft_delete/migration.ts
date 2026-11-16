#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/ab8069b1ee7441e95c7917a1484722a72243195dfc53a703b0574f017d1e41cd/contract';
import endContract from '../../snapshots/ab8069b1ee7441e95c7917a1484722a72243195dfc53a703b0574f017d1e41cd/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/dd5251132749ee6f04164c0340a18da57bd5f862bc07c913bcba4eff8d2aed34/contract';
import startContract from '../../snapshots/dd5251132749ee6f04164c0340a18da57bd5f862bc07c913bcba4eff8d2aed34/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'Session',
        column: col('deletedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('deletedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
