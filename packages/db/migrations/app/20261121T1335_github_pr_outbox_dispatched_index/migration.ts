#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/49996ca5c4f3f35d0cddd0e5a98397a2104b25dd3d3d67a605946e838d9529c4/contract';
import startContract from '../../snapshots/49996ca5c4f3f35d0cddd0e5a98397a2104b25dd3d3d67a605946e838d9529c4/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c746171405bfe47231db56934b722ceb1571a3839b181bde4cf88a4c8c39b411/contract';
import endContract from '../../snapshots/c746171405bfe47231db56934b722ceb1571a3839b181bde4cf88a4c8c39b411/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createIndex({
        schema: 'public',
        table: 'GithubPrOutbox',
        index: 'GithubPrOutbox_dispatched_idx_be1dcc49',
        columns: ['dispatchedAt'],
        extras: { where: sql`("dispatchedAt" IS NOT NULL)` },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
