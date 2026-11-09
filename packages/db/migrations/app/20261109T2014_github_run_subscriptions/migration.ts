#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/31919bc07e05f8bd7cdba3993d5e8d4da55238cdb6046ca1a203c484218b01ab/contract';
import endContract from '../../snapshots/31919bc07e05f8bd7cdba3993d5e8d4da55238cdb6046ca1a203c484218b01ab/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/fb4a01e3e565fbd17d8a11d9d55a9d020162246ae2303cef78babdc52b7b84dd/contract';
import startContract from '../../snapshots/fb4a01e3e565fbd17d8a11d9d55a9d020162246ae2303cef78babdc52b7b84dd/contract.json' with { type: 'json' };
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
