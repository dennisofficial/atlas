#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/3e34f4cf3a0384ac6ed67d1108e74534a33a20a41f7eecd38f6c47c64598ef94/contract';
import startContract from '../../snapshots/3e34f4cf3a0384ac6ed67d1108e74534a33a20a41f7eecd38f6c47c64598ef94/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/7f1e84f71623998fdd5fe3e32afb6b5c4bf03a67249c07cd8c3e48dc1d936ee0/contract';
import endContract from '../../snapshots/7f1e84f71623998fdd5fe3e32afb6b5c4bf03a67249c07cd8c3e48dc1d936ee0/contract.json' with { type: 'json' };
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
