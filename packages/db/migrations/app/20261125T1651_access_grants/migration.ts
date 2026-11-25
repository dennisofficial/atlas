#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/49cfe0bcc6c8d87db6f762e53cc306f42eda6e5e0ebde5e5aad54032999a12b9/contract';
import startContract from '../../snapshots/49cfe0bcc6c8d87db6f762e53cc306f42eda6e5e0ebde5e5aad54032999a12b9/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/b2ceade6147a05e0909288afc4005d74bfe3aad56dfa8a9358395b0f86b90930/contract';
import endContract from '../../snapshots/b2ceade6147a05e0909288afc4005d74bfe3aad56dfa8a9358395b0f86b90930/contract.json' with { type: 'json' };
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
        table: 'ProjectAccessGrant',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('instruction', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'UserAccessGrant',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('instruction', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'ProjectFileMount',
        column: col('grantId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'ProjectSecret',
        column: col('grantId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'SecretEntry',
        column: col('grantId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'ProjectAccessGrant',
        constraint: 'ProjectAccessGrant_projectId_name_key',
        columns: ['projectId', 'name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'UserAccessGrant',
        constraint: 'UserAccessGrant_userId_name_key',
        columns: ['userId', 'name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'ProjectAccessGrant',
        index: 'ProjectAccessGrant_projectId_idx_a96e4d92',
        columns: ['projectId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'ProjectFileMount',
        index: 'ProjectFileMount_grantId_idx_2360ae61',
        columns: ['grantId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'ProjectSecret',
        index: 'ProjectSecret_grantId_idx_2360ae61',
        columns: ['grantId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'SecretEntry',
        index: 'SecretEntry_grantId_idx_2360ae61',
        columns: ['grantId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'UserAccessGrant',
        index: 'UserAccessGrant_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ProjectAccessGrant',
        foreignKey: {
          name: 'ProjectAccessGrant_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'Project', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ProjectFileMount',
        foreignKey: {
          name: 'ProjectFileMount_grantId_fkey',
          columns: ['grantId'],
          references: { schema: 'public', table: 'ProjectAccessGrant', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ProjectSecret',
        foreignKey: {
          name: 'ProjectSecret_grantId_fkey',
          columns: ['grantId'],
          references: { schema: 'public', table: 'ProjectAccessGrant', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'UserAccessGrant',
        foreignKey: {
          name: 'UserAccessGrant_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'SecretEntry',
        foreignKey: {
          name: 'SecretEntry_grantId_fkey',
          columns: ['grantId'],
          references: { schema: 'public', table: 'UserAccessGrant', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
