#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4e8f8d4679e4d2a3d9c6f451da4701aae4cad8fa6b9f194f287b094fde1c3932/contract';
import startContract from '../../snapshots/4e8f8d4679e4d2a3d9c6f451da4701aae4cad8fa6b9f194f287b094fde1c3932/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c6274268faee4d3d652622919270c0984d8ec8c5d589c4774061dd813f11fa97/contract';
import endContract from '../../snapshots/c6274268faee4d3d652622919270c0984d8ec8c5d589c4774061dd813f11fa97/contract.json' with { type: 'json' };
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
