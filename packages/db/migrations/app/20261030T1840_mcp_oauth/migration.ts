#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/80d413755dd13ad67ff66f9633530718bc157c37bb693509cbc2b52ccf0b3f71/contract';
import startContract from '../../snapshots/80d413755dd13ad67ff66f9633530718bc157c37bb693509cbc2b52ccf0b3f71/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/89d0e01e024a2b52ea52e576ed299d368420e8504f2b2d344831cf8862473b00/contract';
import endContract from '../../snapshots/89d0e01e024a2b52ea52e576ed299d368420e8504f2b2d344831cf8862473b00/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'McpOauthGrant',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('generation', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('refreshAttempt', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('refreshStartedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('sealed', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('serverUrl', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('active'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'McpOauthPending',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('expiresAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('returnTo', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sealed', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('serverUrl', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'McpOauthGrant',
        constraint: 'McpOauthGrant_userId_serverUrl_key',
        columns: ['userId', 'serverUrl'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'McpOauthPending',
        index: 'McpOauthPending_userId_idx',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'McpOauthGrant',
        foreignKey: {
          name: 'McpOauthGrant_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'McpOauthPending',
        foreignKey: {
          name: 'McpOauthPending_userId_fkey',
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
