#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/419b73dd7ccf410f5f3dca1e6722d5d82ea53438cce0aa3929fb0d7cec776664/contract';
import startContract from '../../snapshots/419b73dd7ccf410f5f3dca1e6722d5d82ea53438cce0aa3929fb0d7cec776664/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/43d6199d8535e370ff8adfa29c80cb268a6c59c8f8a659ba7c1881af231aaa1f/contract';
import endContract from '../../snapshots/43d6199d8535e370ff8adfa29c80cb268a6c59c8f8a659ba7c1881af231aaa1f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'v2',
        table: 'V2Routine',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('cron', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('enabled', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastRunAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('lastSessionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('modelEffort', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('modelFast', 'bool', { codecRef: { codecId: 'pg/bool@1' } }),
          col('modelRef', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('nextRunAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('prompt', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('timezone', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'v2',
        table: 'V2RoutineRun',
        columns: [
          col('at', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('outcome', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('routineId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('scheduledFor', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('sessionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2Routine',
        index: 'V2Routine_enabled_nextRunAt_idx_a011dd38',
        columns: ['enabled', 'nextRunAt'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2Routine',
        index: 'V2Routine_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2RoutineRun',
        index: 'V2RoutineRun_routineId_at_idx_d4a1c233',
        columns: ['routineId', 'at'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
