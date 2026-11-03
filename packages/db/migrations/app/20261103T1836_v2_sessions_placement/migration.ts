#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/083160e4eedef6a7f27b947e55e638fbfdf83d71400630227fde2da17b5597ce/contract';
import startContract from '../../snapshots/083160e4eedef6a7f27b947e55e638fbfdf83d71400630227fde2da17b5597ce/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/96a58c74578fef8a57dbe2a85eb50c8851a3f9bc932a4544d63fbae1ac520785/contract';
import endContract from '../../snapshots/96a58c74578fef8a57dbe2a85eb50c8851a3f9bc932a4544d63fbae1ac520785/contract.json' with { type: 'json' };
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
