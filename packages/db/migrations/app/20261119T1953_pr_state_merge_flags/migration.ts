#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0286ec8602a1bd3709199639e2b9ef43150ddc2bda27f43ba7206442e135fd48/contract';
import startContract from '../../snapshots/0286ec8602a1bd3709199639e2b9ef43150ddc2bda27f43ba7206442e135fd48/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/2040fdaad1f6b437ef3fbbe002f96b4f07954f628cc8c799e5b774fb6be69f0f/contract';
import endContract from '../../snapshots/2040fdaad1f6b437ef3fbbe002f96b4f07954f628cc8c799e5b774fb6be69f0f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: col('autoMerge', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: col('mergeQueued', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
