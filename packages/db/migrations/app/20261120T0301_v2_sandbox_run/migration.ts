#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/65e8ab17771d5cf4f5d0a9493da0d7d329095a90a570b74cf08d3bbb317f390d/contract';
import startContract from '../../snapshots/65e8ab17771d5cf4f5d0a9493da0d7d329095a90a570b74cf08d3bbb317f390d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/76eef62c5f7a890871af1fa51b0bb2ffd26177915dc65c8049fb3f48c52e8607/contract';
import endContract from '../../snapshots/76eef62c5f7a890871af1fa51b0bb2ffd26177915dc65c8049fb3f48c52e8607/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'v2',
        table: 'V2SandboxRun',
        columns: [
          col('activeCpuMs', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('awakeMs', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('costSource', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('costUsd', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
          col('cpuBaselineMs', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('diskGb', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('endedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('memoryGb', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('provider', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sandboxInstanceId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('vcpus', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2SandboxRun',
        index: 'V2SandboxRun_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2SandboxRun',
        index: 'V2SandboxRun_sessionId_startedAt_idx_e70936f3',
        columns: ['sessionId', 'startedAt'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2SandboxRun',
        index: 'V2SandboxRun_userId_startedAt_idx_91bd1466',
        columns: ['userId', 'startedAt'],
      }),
      this.addForeignKey({
        schema: 'v2',
        table: 'V2SandboxRun',
        foreignKey: {
          name: 'V2SandboxRun_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'v2', table: 'V2Session', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
