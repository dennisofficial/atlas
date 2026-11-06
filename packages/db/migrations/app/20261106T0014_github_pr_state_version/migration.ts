#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0b57a2d5716c39ad7c93b2986be3c39df495f56d87664a41cdb974c6cbe50f2d/contract';
import endContract from '../../snapshots/0b57a2d5716c39ad7c93b2986be3c39df495f56d87664a41cdb974c6cbe50f2d/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/9151e8e7aba5a6a6267bfe81b5db0755f855090aa4292499b46b36b113aa4599/contract';
import startContract from '../../snapshots/9151e8e7aba5a6a6267bfe81b5db0755f855090aa4292499b46b36b113aa4599/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: col('version', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
