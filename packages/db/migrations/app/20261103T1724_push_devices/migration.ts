#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0f01c00d02783fa0b4af02e4ac7200a9fd602d97f2b8975e3092818324485a21/contract';
import startContract from '../../snapshots/0f01c00d02783fa0b4af02e4ac7200a9fd602d97f2b8975e3092818324485a21/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f7cf7c56bb555f5aa57091945412cf5f344de9baeab363e63a715cc76fd704d8/contract';
import endContract from '../../snapshots/f7cf7c56bb555f5aa57091945412cf5f344de9baeab363e63a715cc76fd704d8/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'PushDevice',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('platform', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('token', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'PushDevice',
        constraint: 'PushDevice_token_key',
        columns: ['token'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'PushDevice',
        index: 'PushDevice_userId_idx',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'PushDevice',
        foreignKey: {
          name: 'PushDevice_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
