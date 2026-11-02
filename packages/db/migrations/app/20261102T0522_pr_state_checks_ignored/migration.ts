#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/bfe49ff940f6329635e9a44412cf28f85606a57b78b461784714fd97ae950a68/contract';
import endContract from '../../snapshots/bfe49ff940f6329635e9a44412cf28f85606a57b78b461784714fd97ae950a68/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c5b4e8931ae1573ece5618b3e55c68c80a2ca0a66bb886923031364116da88a9/contract';
import startContract from '../../snapshots/c5b4e8931ae1573ece5618b3e55c68c80a2ca0a66bb886923031364116da88a9/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: col('checksIgnored', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
