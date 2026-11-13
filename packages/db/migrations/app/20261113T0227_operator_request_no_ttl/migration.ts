#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/a1d7da1e092b7832619e7438fc84a790bd3244eaf29625754bd2ee821901b4e2/contract';
import endContract from '../../snapshots/a1d7da1e092b7832619e7438fc84a790bd3244eaf29625754bd2ee821901b4e2/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/d232f37cbb4ac571f07d4879ffa697bf5acfd9888297ff6e7b6d47651a2d9850/contract';
import startContract from '../../snapshots/d232f37cbb4ac571f07d4879ffa697bf5acfd9888297ff6e7b6d47651a2d9850/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropIndex({
        schema: 'v2',
        table: 'V2OperatorRequest',
        index: 'V2OperatorRequest_status_expiresAt_idx_c206f415',
      }),
      this.dropColumn({ schema: 'v2', table: 'V2OperatorRequest', column: 'expiresAt' }),
      this.createIndex({
        schema: 'v2',
        table: 'V2OperatorRequest',
        index: 'V2OperatorRequest_status_idx_e98638ab',
        columns: ['status'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
