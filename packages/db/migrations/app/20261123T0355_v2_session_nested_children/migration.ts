#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5f6ba3b9a87739af644f00c807db2de56d9da1d4d40cb7abcee4b41cc847463d/contract';
import startContract from '../../snapshots/5f6ba3b9a87739af644f00c807db2de56d9da1d4d40cb7abcee4b41cc847463d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c91251b96f41b44ec86962b7178768299cbda52cddd9ab9e30e48129525459d7/contract';
import endContract from '../../snapshots/c91251b96f41b44ec86962b7178768299cbda52cddd9ab9e30e48129525459d7/contract.json' with { type: 'json' };
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
