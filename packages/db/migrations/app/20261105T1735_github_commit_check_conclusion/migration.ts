#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/9151e8e7aba5a6a6267bfe81b5db0755f855090aa4292499b46b36b113aa4599/contract';
import endContract from '../../snapshots/9151e8e7aba5a6a6267bfe81b5db0755f855090aa4292499b46b36b113aa4599/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f35adc786c78bd210a084bb4842db0ff8a17a5d01ac78ff2cbac99e9cd3fe642/contract';
import startContract from '../../snapshots/f35adc786c78bd210a084bb4842db0ff8a17a5d01ac78ff2cbac99e9cd3fe642/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubCommitCheck',
        column: col('conclusion', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
