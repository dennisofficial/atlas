#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/aa1b7cae47cb713403ff8470e581f04f4da268821b153afa71bfdf55edf5768d/contract';
import startContract from '../../snapshots/aa1b7cae47cb713403ff8470e581f04f4da268821b153afa71bfdf55edf5768d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/fcf5f2f472f53ca8bda3c73a89a716d254bccc9559abec5d6e0f6adb298b836e/contract';
import endContract from '../../snapshots/fcf5f2f472f53ca8bda3c73a89a716d254bccc9559abec5d6e0f6adb298b836e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';
import { deleteLeftoverV2Rows } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      deleteLeftoverV2Rows,
      this.addColumn({
        schema: 'v2',
        table: 'V2Lease',
        column: col('wantsHolder', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('mainThreadId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('title', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2InboxEntry',
        index: 'V2InboxEntry_consumedSeq_sessionId_idx_58d8d6fc',
        columns: ['consumedSeq', 'sessionId'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2Session',
        index: 'V2Session_userId_createdAt_idx_f726f04a',
        columns: ['userId', 'createdAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
