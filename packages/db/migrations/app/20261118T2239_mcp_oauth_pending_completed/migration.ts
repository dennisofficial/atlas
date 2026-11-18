#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/b880c65f607b166b6d4bc082fb39f8fbf8db741dd330ddafee93a35a0f7c01c0/contract';
import endContract from '../../snapshots/b880c65f607b166b6d4bc082fb39f8fbf8db741dd330ddafee93a35a0f7c01c0/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/fe7026b0bafb2b5365ea4cb7162f26f4060d11115bc29bee8787d1f3d102a2e1/contract';
import startContract from '../../snapshots/fe7026b0bafb2b5365ea4cb7162f26f4060d11115bc29bee8787d1f3d102a2e1/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'McpOauthPending',
        column: col('completedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
