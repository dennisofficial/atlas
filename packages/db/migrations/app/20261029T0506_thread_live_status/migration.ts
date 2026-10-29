#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/39a8a18937eb04ea58258bff54a1e505d0eb2c61ea30001dbdcfb8fe17d7ee55/contract';
import endContract from '../../snapshots/39a8a18937eb04ea58258bff54a1e505d0eb2c61ea30001dbdcfb8fe17d7ee55/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/946def7626177495469475dd9a426226c7de44f7e8e71d88ab4574016887bcdb/contract';
import startContract from '../../snapshots/946def7626177495469475dd9a426226c7de44f7e8e71d88ab4574016887bcdb/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'ThreadRead',
        columns: [
          col('seq', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('threadId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['userId', 'threadId'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'Thread',
        column: col('activityAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Thread',
        column: col('awaiting', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Thread',
        column: col('lastAssistantSeq', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Thread',
        column: col('lastOutcome', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Thread',
        column: col('working', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'ThreadRead',
        index: 'ThreadRead_threadId_idx',
        columns: ['threadId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'ThreadRead',
        index: 'ThreadRead_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ThreadRead',
        foreignKey: {
          name: 'ThreadRead_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ThreadRead',
        foreignKey: {
          name: 'ThreadRead_threadId_fkey',
          columns: ['threadId'],
          references: { schema: 'public', table: 'Thread', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
