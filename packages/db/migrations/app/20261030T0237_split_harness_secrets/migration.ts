#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1f29b6b2d37c5afc2213f8109458d7518b4f21d3304c9b367f1526917851a586/contract';
import startContract from '../../snapshots/1f29b6b2d37c5afc2213f8109458d7518b4f21d3304c9b367f1526917851a586/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/80d413755dd13ad67ff66f9633530718bc157c37bb693509cbc2b52ccf0b3f71/contract';
import endContract from '../../snapshots/80d413755dd13ad67ff66f9633530718bc157c37bb693509cbc2b52ccf0b3f71/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';
import { copyHarnessSecrets, deleteNonEnvSecrets } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'UserHarnessSecret',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sealedValue', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
        table: 'UserHarnessSecret',
        constraint: 'UserHarnessSecret_userId_name_key',
        columns: ['userId', 'name'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'UserHarnessSecret',
        foreignKey: {
          name: 'UserHarnessSecret_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      copyHarnessSecrets,
      deleteNonEnvSecrets,
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
