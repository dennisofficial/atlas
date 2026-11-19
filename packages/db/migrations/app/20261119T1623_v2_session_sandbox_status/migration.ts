#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/8ff92224609f6e96b53098608e35a84a6a8c06de5545ab4e1f85bdd0fc13579c/contract';
import endContract from '../../snapshots/8ff92224609f6e96b53098608e35a84a6a8c06de5545ab4e1f85bdd0fc13579c/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b3d260c93b2482a08fb1673253a185d6399e44d37cc1a4b8e0c07c6b04d346bf/contract';
import startContract from '../../snapshots/b3d260c93b2482a08fb1673253a185d6399e44d37cc1a4b8e0c07c6b04d346bf/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('sandboxStatus', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('sandboxStatusAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2Session',
        index: 'V2Session_sandboxInstanceId_idx_c3850fdd',
        columns: ['sandboxInstanceId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
