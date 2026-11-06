#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0b57a2d5716c39ad7c93b2986be3c39df495f56d87664a41cdb974c6cbe50f2d/contract';
import startContract from '../../snapshots/0b57a2d5716c39ad7c93b2986be3c39df495f56d87664a41cdb974c6cbe50f2d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/41eb9776117c6b638bf351597741640c89954131da999dbe999dd15e05a5d04d/contract';
import endContract from '../../snapshots/41eb9776117c6b638bf351597741640c89954131da999dbe999dd15e05a5d04d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubWebhookInbox',
        column: col('deadAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubWebhookInbox',
        column: col('leaseUntil', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubWebhookInbox',
        column: col('nextAttemptAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
