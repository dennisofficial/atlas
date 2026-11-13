#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/9a9bc38e125fa6c370aa35a91fe69c049cdd08a9d6440dd4fe679446a7e2e61f/contract';
import endContract from '../../snapshots/9a9bc38e125fa6c370aa35a91fe69c049cdd08a9d6440dd4fe679446a7e2e61f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/db9883fc7594d4a56041e19c67ee2bc21db9bf9fd2e454a4e93a2de083606340/contract';
import startContract from '../../snapshots/db9883fc7594d4a56041e19c67ee2bc21db9bf9fd2e454a4e93a2de083606340/contract.json' with { type: 'json' };
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
