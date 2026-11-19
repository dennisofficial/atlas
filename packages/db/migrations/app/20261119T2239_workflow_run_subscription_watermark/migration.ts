#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4406b81cac8b98381149af5769abd34522833966d2564835450f6715e509fe49/contract';
import startContract from '../../snapshots/4406b81cac8b98381149af5769abd34522833966d2564835450f6715e509fe49/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f7543aa4035670134d8a1239a96708503be0cb7ff56d300ae497ebe2fbdfca19/contract';
import endContract from '../../snapshots/f7543aa4035670134d8a1239a96708503be0cb7ff56d300ae497ebe2fbdfca19/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubSubscription',
        column: col('lastRunCreatedAt', 'timestamptz(3)', {
          notNull: true,
          default: fn(sql`now()`),
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
