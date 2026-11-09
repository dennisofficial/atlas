#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/7bfd5c78c7eb576e3dba9c50b3e878422997fad5425fb8443f0964ee6bc7e638/contract';
import startContract from '../../snapshots/7bfd5c78c7eb576e3dba9c50b3e878422997fad5425fb8443f0964ee6bc7e638/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e0eb0bdf7772e30f41d90fe70ec8ee76922e5d4355f15dda7d6cb929a897005a/contract';
import endContract from '../../snapshots/e0eb0bdf7772e30f41d90fe70ec8ee76922e5d4355f15dda7d6cb929a897005a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2InboxEntry',
        column: col('senderSessionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('peerMessagesSent', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('podSessionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('spawnedBySessionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
