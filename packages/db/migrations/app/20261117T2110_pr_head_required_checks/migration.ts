#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/73043ecb817e914770efa0109aa9b44ce9f3c62f02ed74ccecd857a958e1b5ce/contract';
import startContract from '../../snapshots/73043ecb817e914770efa0109aa9b44ce9f3c62f02ed74ccecd857a958e1b5ce/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e10afd6f04a655c4be2c0eafdcb177d67f2441abf67ede2e9888844edd9e68ef/contract';
import endContract from '../../snapshots/e10afd6f04a655c4be2c0eafdcb177d67f2441abf67ede2e9888844edd9e68ef/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: col('mergeClean', 'bool', { codecRef: { codecId: 'pg/bool@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: col('requiredCheckContexts', 'text[]', {
          notNull: true,
          default: lit([]),
          codecRef: { codecId: 'pg/text@1', many: true },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'GithubPrState',
        constraint: 'GithubPrState_requiredCheckContexts_elem_not_null_eafd55ca',
        expression: sql`array_position("requiredCheckContexts", NULL) IS NULL`,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
