#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/6b9d370124c540cc9199fd72746fa8fa368e613c6e21ea298f5943dfde733efc/contract';
import endContract from '../../snapshots/6b9d370124c540cc9199fd72746fa8fa368e613c6e21ea298f5943dfde733efc/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e0eb0bdf7772e30f41d90fe70ec8ee76922e5d4355f15dda7d6cb929a897005a/contract';
import startContract from '../../snapshots/e0eb0bdf7772e30f41d90fe70ec8ee76922e5d4355f15dda7d6cb929a897005a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubSubscription',
        column: col('deliveredRunId', 'text', {
          notNull: true,
          default: lit(''),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubSubscription',
        column: col('kind', 'text', {
          notNull: true,
          default: lit('pull-request'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
