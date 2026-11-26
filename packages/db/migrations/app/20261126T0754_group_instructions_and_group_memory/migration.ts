#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/682b49388e4e1247af1b52d9cc6a6d082ff410b7332e8da6a8a03c52fb702ee4/contract';
import endContract from '../../snapshots/682b49388e4e1247af1b52d9cc6a6d082ff410b7332e8da6a8a03c52fb702ee4/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f25064e86faed013784d2529208762579252965c1faf1494f13e290450bef2eb/contract';
import startContract from '../../snapshots/f25064e86faed013784d2529208762579252965c1faf1494f13e290450bef2eb/contract.json' with { type: 'json' };
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
      this.dropConstraint({
        schema: 'public',
        table: 'Memory',
        constraint: 'Memory_userId_scope_project_name_key',
      }),
      this.createTable({
        schema: 'public',
        table: 'GroupInstruction',
        columns: [
          col('content', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('groupId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'Memory',
        column: col('groupId', 'text', {
          notNull: true,
          default: lit(''),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'GroupInstruction',
        constraint: 'GroupInstruction_groupId_key',
        columns: ['groupId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'Memory',
        constraint: 'Memory_userId_scope_groupId_project_name_key',
        columns: ['userId', 'scope', 'groupId', 'project', 'name'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Memory',
        index: 'Memory_userId_groupId_idx',
        columns: ['userId', 'groupId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'GroupInstruction',
        foreignKey: {
          name: 'GroupInstruction_groupId_fkey',
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
