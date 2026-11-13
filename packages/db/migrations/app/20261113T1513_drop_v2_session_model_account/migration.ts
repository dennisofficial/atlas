#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/798163a5e9fca8b08d9dd7a0622cee13a366ccfb761ff472c91f3721e959bd5a/contract';
import endContract from '../../snapshots/798163a5e9fca8b08d9dd7a0622cee13a366ccfb761ff472c91f3721e959bd5a/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/921b9a105ffcf31b97210047381d89edef0947f00b926e04a86124e6607ce08b/contract';
import startContract from '../../snapshots/921b9a105ffcf31b97210047381d89edef0947f00b926e04a86124e6607ce08b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.dropColumn({ schema: 'v2', table: 'V2Session', column: 'modelAccountId' })];
  }
}

MigrationCLI.run(import.meta.url, M);
