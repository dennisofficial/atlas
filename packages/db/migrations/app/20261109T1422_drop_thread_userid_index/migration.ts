#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/7bfd5c78c7eb576e3dba9c50b3e878422997fad5425fb8443f0964ee6bc7e638/contract';
import endContract from '../../snapshots/7bfd5c78c7eb576e3dba9c50b3e878422997fad5425fb8443f0964ee6bc7e638/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/7d575a2f90a2bd1fc58e196fe37784b57392947281b09cba18ca680cb3714c04/contract';
import startContract from '../../snapshots/7d575a2f90a2bd1fc58e196fe37784b57392947281b09cba18ca680cb3714c04/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropIndex({ schema: 'public', table: 'Thread', index: 'Thread_userId_updatedAt_idx' }),
      this.createIndex({
        schema: 'public',
        table: 'Thread',
        index: 'Thread_userId_idx_a489d58a',
        columns: ['userId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
