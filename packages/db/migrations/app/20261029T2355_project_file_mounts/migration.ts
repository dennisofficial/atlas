#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/a81a3193f0178f2224163adb9fff0d54f35cc4c56dfe45ff7afe1c194562efd7/contract';
import startContract from '../../snapshots/a81a3193f0178f2224163adb9fff0d54f35cc4c56dfe45ff7afe1c194562efd7/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e07ae9a598861423b56f58f537da83035af72b4444e26e28b3f1a1617fd53574/contract';
import endContract from '../../snapshots/e07ae9a598861423b56f58f537da83035af72b4444e26e28b3f1a1617fd53574/contract.json' with { type: 'json' };
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
        table: 'ProjectFileMount',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mode', 'int4', {
            notNull: true,
            default: lit(384),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('path', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('projectId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sealedContents', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'ProjectFileMount',
        constraint: 'ProjectFileMount_projectId_path_key',
        columns: ['projectId', 'path'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ProjectFileMount',
        foreignKey: {
          name: 'ProjectFileMount_projectId_fkey',
          columns: ['projectId'],
          references: { schema: 'public', table: 'Project', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
