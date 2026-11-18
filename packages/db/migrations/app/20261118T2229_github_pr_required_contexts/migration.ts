#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/04bc31236a81dff5e209b163f3961960d73bc56f23b5f7453ebc8f10d2a0605f/contract';
import endContract from '../../snapshots/04bc31236a81dff5e209b163f3961960d73bc56f23b5f7453ebc8f10d2a0605f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/440aade754b29db78c71837295de8d12133fae48cc9290e2cb2570999e2a38ba/contract';
import startContract from '../../snapshots/440aade754b29db78c71837295de8d12133fae48cc9290e2cb2570999e2a38ba/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'GithubPrState',
        constraint: 'GithubPrState_requiredCheckContexts_elem_not_null_eafd55ca',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: 'requiredCheckContexts',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
