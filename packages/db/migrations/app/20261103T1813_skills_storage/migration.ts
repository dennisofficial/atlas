#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/016fa1c833e109cf4144ef62082fdab50548ec380c0f5927f2acbb0d84c74729/contract';
import endContract from '../../snapshots/016fa1c833e109cf4144ef62082fdab50548ec380c0f5927f2acbb0d84c74729/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/7a7a0970243dce02319d461c9fa8529535ad94488bba092dd38e313a6b109939/contract';
import startContract from '../../snapshots/7a7a0970243dce02319d461c9fa8529535ad94488bba092dd38e313a6b109939/contract.json' with { type: 'json' };
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

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'Skill',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('description', 'text', {
            notNull: true,
            default: lit(''),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'Skill_owner_check_67d0cc6e',
            sql`("userId" IS NULL) <> ("projectId" IS NULL)`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'SkillFile',
        columns: [
          col('content', 'bytea', { notNull: true, codecRef: { codecId: 'pg/bytea@1' } }),
          col('contentHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isText', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('path', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('revision', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('size', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('skillId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'Skill',
        constraint: 'Skill_projectId_name_key',
        columns: ['projectId', 'name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'Skill',
        constraint: 'Skill_userId_name_key',
        columns: ['userId', 'name'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'SkillFile',
        constraint: 'SkillFile_skillId_path_key',
        columns: ['skillId', 'path'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'SkillFile',
        index: 'SkillFile_skillId_revision_idx',
        columns: ['skillId', 'revision'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Skill',
        foreignKey: {
          name: 'Skill_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Skill',
        foreignKey: {
          name: 'Skill_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'Project', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'SkillFile',
        foreignKey: {
          name: 'SkillFile_skillId_fkey',
          columns: ['skillId'],
          references: { schema: 'public', table: 'Skill', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
