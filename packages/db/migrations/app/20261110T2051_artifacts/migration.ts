#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/419b73dd7ccf410f5f3dca1e6722d5d82ea53438cce0aa3929fb0d7cec776664/contract';
import startContract from '../../snapshots/419b73dd7ccf410f5f3dca1e6722d5d82ea53438cce0aa3929fb0d7cec776664/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/fd9a0832ce16a151a78adc54604d9147ad4852ed10a1b6c4f8d51fbdd13ed562/contract';
import endContract from '../../snapshots/fd9a0832ce16a151a78adc54604d9147ad4852ed10a1b6c4f8d51fbdd13ed562/contract.json' with { type: 'json' };
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
        table: 'Artifact',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('currentVersion', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('slug', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('token', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
        table: 'ArtifactVersion',
        columns: [
          col('artifactId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('bytes', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('durationMs', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('failure', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('fileCount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('log', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('manifest', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('sourceHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('spec', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('specHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('version', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'Artifact',
        constraint: 'Artifact_token_key',
        columns: ['token'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'Artifact',
        constraint: 'Artifact_userId_slug_key',
        columns: ['userId', 'slug'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'ArtifactVersion',
        constraint: 'ArtifactVersion_artifactId_version_key',
        columns: ['artifactId', 'version'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Artifact',
        index: 'Artifact_userId_idx',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'ArtifactVersion',
        index: 'ArtifactVersion_artifactId_idx',
        columns: ['artifactId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Artifact',
        foreignKey: {
          name: 'Artifact_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ArtifactVersion',
        foreignKey: {
          name: 'ArtifactVersion_artifactId_fkey',
          columns: ['artifactId'],
          references: { schema: 'public', table: 'Artifact', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
