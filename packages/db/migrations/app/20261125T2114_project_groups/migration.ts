#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/8d7bb4c0a917ecd62f0a95660731171b1ffaf8ed69846ad2993cb1b7261082b0/contract';
import endContract from '../../snapshots/8d7bb4c0a917ecd62f0a95660731171b1ffaf8ed69846ad2993cb1b7261082b0/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b8bdb59b76c5bf1cf9ac5de976d5a40e93a37924ef1ca187fffd2bff7b085aca/contract';
import startContract from '../../snapshots/b8bdb59b76c5bf1cf9ac5de976d5a40e93a37924ef1ca187fffd2bff7b085aca/contract.json' with { type: 'json' };
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
      this.dropCheckConstraint({
        schema: 'public',
        table: 'McpServer',
        constraint: 'McpServer_one_scope_67d0cc6e',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'Skill',
        constraint: 'Skill_owner_check_67d0cc6e',
      }),
      this.createTable({
        schema: 'public',
        table: 'GroupAccessGrant',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('groupId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'GroupFileMount',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('grantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('groupId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mode', 'int4', {
            notNull: true,
            default: lit(384),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('path', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sealedContents', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'GroupSecret',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('grantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('groupId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sealedValue', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'GroupSetting',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('groupId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'ProjectGroup',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
        table: 'McpServer',
        column: col('groupId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Project',
        column: col('groupId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Skill',
        column: col('groupId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'GroupAccessGrant',
        constraint: 'GroupAccessGrant_groupId_name_key',
        columns: ['groupId', 'name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'GroupFileMount',
        constraint: 'GroupFileMount_groupId_path_key',
        columns: ['groupId', 'path'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'GroupSecret',
        constraint: 'GroupSecret_groupId_name_key',
        columns: ['groupId', 'name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'GroupSetting',
        constraint: 'GroupSetting_groupId_key_key',
        columns: ['groupId', 'key'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'McpServer',
        constraint: 'McpServer_one_scope_1e7116ff',
        expression: sql`("userId" IS NOT NULL)::int + ("projectId" IS NOT NULL)::int + ("groupId" IS NOT NULL)::int = 1`,
      }),
      this.addUnique({
        schema: 'public',
        table: 'McpServer',
        constraint: 'McpServer_groupId_source_name_key',
        columns: ['groupId', 'source', 'name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'ProjectGroup',
        constraint: 'ProjectGroup_userId_name_key',
        columns: ['userId', 'name'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'Skill',
        constraint: 'Skill_owner_check_1e7116ff',
        expression: sql`("userId" IS NOT NULL)::int + ("projectId" IS NOT NULL)::int + ("groupId" IS NOT NULL)::int = 1`,
      }),
      this.addUnique({
        schema: 'public',
        table: 'Skill',
        constraint: 'Skill_groupId_name_key',
        columns: ['groupId', 'name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'GroupAccessGrant',
        index: 'GroupAccessGrant_groupId_idx_e2fb5578',
        columns: ['groupId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'GroupFileMount',
        index: 'GroupFileMount_grantId_idx_2360ae61',
        columns: ['grantId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'GroupSecret',
        index: 'GroupSecret_grantId_idx_2360ae61',
        columns: ['grantId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Project',
        index: 'Project_groupId_idx_e2fb5578',
        columns: ['groupId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'GroupAccessGrant',
        foreignKey: {
          name: 'GroupAccessGrant_groupId_fkey',
          columns: ['groupId'],
          references: { schema: 'public', table: 'ProjectGroup', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'GroupFileMount',
        foreignKey: {
          name: 'GroupFileMount_groupId_fkey',
          columns: ['groupId'],
          references: { schema: 'public', table: 'ProjectGroup', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'GroupFileMount',
        foreignKey: {
          name: 'GroupFileMount_grantId_fkey',
          columns: ['grantId'],
          references: { schema: 'public', table: 'GroupAccessGrant', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'GroupSecret',
        foreignKey: {
          name: 'GroupSecret_groupId_fkey',
          columns: ['groupId'],
          references: { schema: 'public', table: 'ProjectGroup', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'GroupSecret',
        foreignKey: {
          name: 'GroupSecret_grantId_fkey',
          columns: ['grantId'],
          references: { schema: 'public', table: 'GroupAccessGrant', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'GroupSetting',
        foreignKey: {
          name: 'GroupSetting_groupId_fkey',
          columns: ['groupId'],
          references: { schema: 'public', table: 'ProjectGroup', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ProjectGroup',
        foreignKey: {
          name: 'ProjectGroup_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'McpServer',
        foreignKey: {
          name: 'McpServer_groupId_fkey',
          columns: ['groupId'],
          references: { schema: 'public', table: 'ProjectGroup', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Project',
        foreignKey: {
          name: 'Project_groupId_fkey',
          columns: ['groupId'],
          references: { schema: 'public', table: 'ProjectGroup', columns: ['id'] },
          onDelete: 'setNull',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Skill',
        foreignKey: {
          name: 'Skill_groupId_fkey',
          columns: ['groupId'],
          references: { schema: 'public', table: 'ProjectGroup', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
