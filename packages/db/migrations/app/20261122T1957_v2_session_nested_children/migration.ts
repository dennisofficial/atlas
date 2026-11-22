#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/027a78bb580bcea4fac8bb1e13e9e3c2ed1ba065836bc46e2fbd208264a5c275/contract';
import startContract from '../../snapshots/027a78bb580bcea4fac8bb1e13e9e3c2ed1ba065836bc46e2fbd208264a5c275/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c65cc71bb642367ce7f2f5765896c927ba800be7fa4456999a195196d9738d8e/contract';
import endContract from '../../snapshots/c65cc71bb642367ce7f2f5765896c927ba800be7fa4456999a195196d9738d8e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createIndex({
        schema: 'v2',
        table: 'V2Session',
        index: 'V2Session_spawnedBySessionId_nested_idx_c61c238d',
        columns: ['spawnedBySessionId', 'nested'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
