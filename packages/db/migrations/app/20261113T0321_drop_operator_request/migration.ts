#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/921b9a105ffcf31b97210047381d89edef0947f00b926e04a86124e6607ce08b/contract';
import endContract from '../../snapshots/921b9a105ffcf31b97210047381d89edef0947f00b926e04a86124e6607ce08b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/a1d7da1e092b7832619e7438fc84a790bd3244eaf29625754bd2ee821901b4e2/contract';
import startContract from '../../snapshots/a1d7da1e092b7832619e7438fc84a790bd3244eaf29625754bd2ee821901b4e2/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.dropTable({ schema: 'v2', table: 'V2OperatorRequest' })];
  }
}

MigrationCLI.run(import.meta.url, M);
