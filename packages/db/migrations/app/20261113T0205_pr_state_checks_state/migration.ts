#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/d232f37cbb4ac571f07d4879ffa697bf5acfd9888297ff6e7b6d47651a2d9850/contract';
import endContract from '../../snapshots/d232f37cbb4ac571f07d4879ffa697bf5acfd9888297ff6e7b6d47651a2d9850/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/db9883fc7594d4a56041e19c67ee2bc21db9bf9fd2e454a4e93a2de083606340/contract';
import startContract from '../../snapshots/db9883fc7594d4a56041e19c67ee2bc21db9bf9fd2e454a4e93a2de083606340/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: col('checksState', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
