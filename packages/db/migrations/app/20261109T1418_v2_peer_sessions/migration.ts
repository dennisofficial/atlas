#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/7d575a2f90a2bd1fc58e196fe37784b57392947281b09cba18ca680cb3714c04/contract';
import startContract from '../../snapshots/7d575a2f90a2bd1fc58e196fe37784b57392947281b09cba18ca680cb3714c04/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ebf8777b2b82d8c930e2fcd0acfe2a111987d8b1354639773a9d84d4e03c8adb/contract';
import endContract from '../../snapshots/ebf8777b2b82d8c930e2fcd0acfe2a111987d8b1354639773a9d84d4e03c8adb/contract.json' with { type: 'json' };
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
