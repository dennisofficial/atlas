#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/00dc597d9dc49e825768c55eb9883c982ce9f1ec5656a8f7390db932eb65cf77/contract';
import startContract from '../../snapshots/00dc597d9dc49e825768c55eb9883c982ce9f1ec5656a8f7390db932eb65cf77/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/4e8f8d4679e4d2a3d9c6f451da4701aae4cad8fa6b9f194f287b094fde1c3932/contract';
import endContract from '../../snapshots/4e8f8d4679e4d2a3d9c6f451da4701aae4cad8fa6b9f194f287b094fde1c3932/contract.json' with { type: 'json' };
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
