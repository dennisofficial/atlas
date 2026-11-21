#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/49996ca5c4f3f35d0cddd0e5a98397a2104b25dd3d3d67a605946e838d9529c4/contract';
import endContract from '../../snapshots/49996ca5c4f3f35d0cddd0e5a98397a2104b25dd3d3d67a605946e838d9529c4/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f13535a1ebf4df5f3c2aa8979830f5e10f36fe0c7d49cc29dff96003e7be2b09/contract';
import startContract from '../../snapshots/f13535a1ebf4df5f3c2aa8979830f5e10f36fe0c7d49cc29dff96003e7be2b09/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('sandboxStatusReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
