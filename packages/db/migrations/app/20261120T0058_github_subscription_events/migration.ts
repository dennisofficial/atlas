#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/47438aeb553b3ddbb60cfc40385b576cfe9ad65d699dfcb1063c5ca3f661d657/contract';
import endContract from '../../snapshots/47438aeb553b3ddbb60cfc40385b576cfe9ad65d699dfcb1063c5ca3f661d657/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f7543aa4035670134d8a1239a96708503be0cb7ff56d300ae497ebe2fbdfca19/contract';
import startContract from '../../snapshots/f7543aa4035670134d8a1239a96708503be0cb7ff56d300ae497ebe2fbdfca19/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubSubscription',
        column: col('events', 'text[]', {
          notNull: true,
          default: lit([]),
          codecRef: { codecId: 'pg/text@1', many: true },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'GithubSubscription',
        constraint: 'GithubSubscription_events_elem_not_null_3fea1ac8',
        expression: sql`array_position("events", NULL) IS NULL`,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
