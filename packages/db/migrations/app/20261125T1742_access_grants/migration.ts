#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/49cfe0bcc6c8d87db6f762e53cc306f42eda6e5e0ebde5e5aad54032999a12b9/contract';
import startContract from '../../snapshots/49cfe0bcc6c8d87db6f762e53cc306f42eda6e5e0ebde5e5aad54032999a12b9/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/b8bdb59b76c5bf1cf9ac5de976d5a40e93a37924ef1ca187fffd2bff7b085aca/contract';
import endContract from '../../snapshots/b8bdb59b76c5bf1cf9ac5de976d5a40e93a37924ef1ca187fffd2bff7b085aca/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
  rawSql,
  sql,
} from '@prisma/orm-postgres/migration';

const ACCESS_GRANT_NAME_MAX = 80

const grantOfOneSql = (args: {
  rowTable: string
  grantTable: string
  ownerColumn: 'userId' | 'projectId'
  labelColumn: 'name' | 'path'
  idPrefix: string
}): string => `
DO $$
DECLARE
  r RECORD;
  base text;
  candidate text;
  suffix text;
  counter int;
  new_id text;
BEGIN
  FOR r IN
    SELECT id, "${args.ownerColumn}", "${args.labelColumn}" AS label
    FROM "public"."${args.rowTable}"
    WHERE "grantId" IS NULL
    ORDER BY "createdAt", id
  LOOP
    base := left(r.label, ${ACCESS_GRANT_NAME_MAX});
    candidate := base;
    counter := 1;
    WHILE EXISTS (
      SELECT 1 FROM "public"."${args.grantTable}"
      WHERE "${args.ownerColumn}" = r."${args.ownerColumn}" AND name = candidate
    ) LOOP
      counter := counter + 1;
      suffix := ' ' || counter::text;
      candidate := left(base, ${ACCESS_GRANT_NAME_MAX} - length(suffix)) || suffix;
    END LOOP;
    new_id := '${args.idPrefix}' || gen_random_uuid()::text;
    INSERT INTO "public"."${args.grantTable}" (id, "${args.ownerColumn}", name, instruction, "createdAt", "updatedAt")
    VALUES (new_id, r."${args.ownerColumn}", candidate, '', now(), now());
    UPDATE "public"."${args.rowTable}" SET "grantId" = new_id WHERE id = r.id;
  END LOOP;
END $$;`

const backfillPersonalSecretGrants = rawSql({
  id: 'data.secret-entry-grant-backfill',
  label: 'Give every user secret a personal access grant named after it',
  operationClass: 'data',
  target: {
    id: 'table.SecretEntry',
    details: { schema: 'public', objectType: 'table' as const, name: 'SecretEntry' },
  },
  precheck: [],
  execute: [
    {
      description: 'Create one UserAccessGrant per user secret and link it',
      sql: grantOfOneSql({
        rowTable: 'SecretEntry',
        grantTable: 'UserAccessGrant',
        ownerColumn: 'userId',
        labelColumn: 'name',
        idPrefix: 'uag_',
      }),
    },
  ],
  postcheck: [],
})

const backfillProjectSecretGrants = rawSql({
  id: 'data.project-secret-grant-backfill',
  label: 'Give every project secret a project access grant named after it',
  operationClass: 'data',
  target: {
    id: 'table.ProjectSecret',
    details: { schema: 'public', objectType: 'table' as const, name: 'ProjectSecret' },
  },
  precheck: [],
  execute: [
    {
      description: 'Create one ProjectAccessGrant per project secret and link it',
      sql: grantOfOneSql({
        rowTable: 'ProjectSecret',
        grantTable: 'ProjectAccessGrant',
        ownerColumn: 'projectId',
        labelColumn: 'name',
        idPrefix: 'pag_',
      }),
    },
  ],
  postcheck: [],
})

const backfillProjectFileMountGrants = rawSql({
  id: 'data.project-file-mount-grant-backfill',
  label: 'Give every project file mount a project access grant named after its path',
  operationClass: 'data',
  target: {
    id: 'table.ProjectFileMount',
    details: { schema: 'public', objectType: 'table' as const, name: 'ProjectFileMount' },
  },
  precheck: [],
  execute: [
    {
      description: 'Create one ProjectAccessGrant per project file mount and link it',
      sql: grantOfOneSql({
        rowTable: 'ProjectFileMount',
        grantTable: 'ProjectAccessGrant',
        ownerColumn: 'projectId',
        labelColumn: 'path',
        idPrefix: 'pag_',
      }),
    },
  ],
  postcheck: [],
})

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
      this.createTable({
        schema: 'public',
        table: 'UserFileMount',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('grantId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
      backfillPersonalSecretGrants,
      backfillProjectSecretGrants,
      backfillProjectFileMountGrants,
      this.setNotNull({ schema: 'public', table: 'ProjectFileMount', column: 'grantId' }),
      this.setNotNull({ schema: 'public', table: 'ProjectSecret', column: 'grantId' }),
      this.setNotNull({ schema: 'public', table: 'SecretEntry', column: 'grantId' }),
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
      this.addUnique({
        schema: 'public',
        table: 'UserFileMount',
        constraint: 'UserFileMount_userId_path_key',
        columns: ['userId', 'path'],
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
      this.createIndex({
        schema: 'public',
        table: 'UserFileMount',
        index: 'UserFileMount_grantId_idx_2360ae61',
        columns: ['grantId'],
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
          onDelete: 'cascade',
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
          onDelete: 'cascade',
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
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'UserFileMount',
        foreignKey: {
          name: 'UserFileMount_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'UserFileMount',
        foreignKey: {
          name: 'UserFileMount_grantId_fkey',
          columns: ['grantId'],
          references: { schema: 'public', table: 'UserAccessGrant', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
