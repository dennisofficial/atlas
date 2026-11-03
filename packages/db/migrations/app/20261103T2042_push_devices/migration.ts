#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/ad89d2c8b47ec53dff58f59ad2bc517d30985a1064d662a54fc3eb62b040d95f/contract';
import endContract from '../../snapshots/ad89d2c8b47ec53dff58f59ad2bc517d30985a1064d662a54fc3eb62b040d95f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/fcf5f2f472f53ca8bda3c73a89a716d254bccc9559abec5d6e0f6adb298b836e/contract';
import startContract from '../../snapshots/fcf5f2f472f53ca8bda3c73a89a716d254bccc9559abec5d6e0f6adb298b836e/contract.json' with { type: 'json' };
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
