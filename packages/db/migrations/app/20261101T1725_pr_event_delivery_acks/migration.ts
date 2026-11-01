#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/18518cc2afa8b273ce1fbe178c79fb8ae7141b1872f63117c8606ff5be9eb08f/contract';
import endContract from '../../snapshots/18518cc2afa8b273ce1fbe178c79fb8ae7141b1872f63117c8606ff5be9eb08f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/ec7794377e3325dd741a9d5a725424432965809ff130632875c2154e47158890/contract';
import startContract from '../../snapshots/ec7794377e3325dd741a9d5a725424432965809ff130632875c2154e47158890/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubPrEvent',
        column: col('consumedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubPrEventDelivery',
        column: col('ackedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubPrEventDelivery',
        column: col('leaseExpiresAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
