#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/00dc597d9dc49e825768c55eb9883c982ce9f1ec5656a8f7390db932eb65cf77/contract';
import startContract from '../../snapshots/00dc597d9dc49e825768c55eb9883c982ce9f1ec5656a8f7390db932eb65cf77/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/346b2d0f20945a4896b92f3a9b64554fb077b7bf6b120f16c69d89cc5d3a3249/contract';
import endContract from '../../snapshots/346b2d0f20945a4896b92f3a9b64554fb077b7bf6b120f16c69d89cc5d3a3249/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'McpOauthPending',
        column: col('returnSurface', 'text', {
          notNull: true,
          default: lit('web'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
