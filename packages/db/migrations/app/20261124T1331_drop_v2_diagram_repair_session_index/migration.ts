#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/974071b9738acba06ec97c43b3b772d4a1d30c3e736601bb053e8bb5156698ae/contract';
import endContract from '../../snapshots/974071b9738acba06ec97c43b3b772d4a1d30c3e736601bb053e8bb5156698ae/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e9f5d77490b65583d7e18d14283d066e1104174218be60d5cc672ca276a87e22/contract';
import startContract from '../../snapshots/e9f5d77490b65583d7e18d14283d066e1104174218be60d5cc672ca276a87e22/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropIndex({
        schema: 'v2',
        table: 'V2DiagramRepair',
        index: 'V2DiagramRepair_sessionId_idx_29f415d4',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
