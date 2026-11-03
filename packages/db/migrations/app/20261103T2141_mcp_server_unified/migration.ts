#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/00dc597d9dc49e825768c55eb9883c982ce9f1ec5656a8f7390db932eb65cf77/contract';
import endContract from '../../snapshots/00dc597d9dc49e825768c55eb9883c982ce9f1ec5656a8f7390db932eb65cf77/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/fcf5f2f472f53ca8bda3c73a89a716d254bccc9559abec5d6e0f6adb298b836e/contract';
import startContract from '../../snapshots/fcf5f2f472f53ca8bda3c73a89a716d254bccc9559abec5d6e0f6adb298b836e/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';
import { copyCloudMcpServers } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'McpServer',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastSeenAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('oauthGeneration', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('oauthRefreshAttempt', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('oauthRefreshStartedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('oauthSealed', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('oauthServerUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('oauthStatus', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('oauthUpdatedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('projectId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('repoUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sealedSpec', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'McpServer_fields_by_source_c3bc79c0',
            sql`(("source" = 'cloud') = ("sealedSpec" IS NOT NULL)) AND (("source" = 'repo') = ("repoUrl" IS NOT NULL AND "lastSeenAt" IS NOT NULL))`,
          ),
          checkExpression(
            'McpServer_oauth_whole_f7c534ab',
            sql`(("oauthSealed" IS NULL) = ("oauthStatus" IS NULL)) AND (("oauthSealed" IS NULL) = ("oauthServerUrl" IS NULL))`,
          ),
          checkExpression(
            'McpServer_one_scope_67d0cc6e',
            sql`("userId" IS NULL) <> ("projectId" IS NULL)`,
          ),
          checkExpression('McpServer_source_check_771442e3', sql`"source" IN ('cloud', 'repo')`),
        ],
      }),
      copyCloudMcpServers,
      this.dropTable({ schema: 'public', table: 'McpOauthGrant' }),
      this.dropTable({ schema: 'public', table: 'McpServerConfig' }),
      this.dropTable({ schema: 'public', table: 'ProjectMcpServer' }),
      this.addColumn({
        schema: 'public',
        table: 'McpOauthPending',
        column: col('mcpServerId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'McpServer',
        constraint: 'McpServer_projectId_source_name_key',
        columns: ['projectId', 'source', 'name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'McpServer',
        constraint: 'McpServer_userId_source_name_key',
        columns: ['userId', 'source', 'name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'McpOauthPending',
        index: 'McpOauthPending_mcpServerId_idx',
        columns: ['mcpServerId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'McpServer',
        index: 'McpServer_source_lastSeenAt_idx',
        columns: ['source', 'lastSeenAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'McpServer',
        foreignKey: {
          name: 'McpServer_userId_fkey',
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
          name: 'McpServer_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'Project', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'McpOauthPending',
        foreignKey: {
          name: 'McpOauthPending_mcpServerId_fkey',
          columns: ['mcpServerId'],
          references: { schema: 'public', table: 'McpServer', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
