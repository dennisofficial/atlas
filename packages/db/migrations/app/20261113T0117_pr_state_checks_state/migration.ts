#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1143c80ee8dbac2b5a381aa19f5806cfa71c9c3de8e53ffb5f82bd8eef4d80e1/contract';
import startContract from '../../snapshots/1143c80ee8dbac2b5a381aa19f5806cfa71c9c3de8e53ffb5f82bd8eef4d80e1/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/21fd599c3fda87ddb8ab61323e823b55da5db6ac781a09eec7cd838576b4dd13/contract';
import endContract from '../../snapshots/21fd599c3fda87ddb8ab61323e823b55da5db6ac781a09eec7cd838576b4dd13/contract.json' with { type: 'json' };
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
