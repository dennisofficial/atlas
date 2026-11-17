#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/73043ecb817e914770efa0109aa9b44ce9f3c62f02ed74ccecd857a958e1b5ce/contract';
import endContract from '../../snapshots/73043ecb817e914770efa0109aa9b44ce9f3c62f02ed74ccecd857a958e1b5ce/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/ab8069b1ee7441e95c7917a1484722a72243195dfc53a703b0574f017d1e41cd/contract';
import startContract from '../../snapshots/ab8069b1ee7441e95c7917a1484722a72243195dfc53a703b0574f017d1e41cd/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.dropNotNull({ schema: 'v2', table: 'V2Session', column: 'projectId' })];
  }
}

MigrationCLI.run(import.meta.url, M);
