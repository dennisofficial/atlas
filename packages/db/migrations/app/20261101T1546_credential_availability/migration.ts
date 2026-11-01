#!/usr/bin/env -S bun
import type { Contract as End } from '../../snapshots/3bbee15ea729039a843a4a8f048d85ed430d10fddef8805972ff255d857056e3/contract';
import endContract from '../../snapshots/3bbee15ea729039a843a4a8f048d85ed430d10fddef8805972ff255d857056e3/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/72a4fc277c7232110726a3363cb7622f7be63fc3f17c5f520460010f70357979/contract';
import startContract from '../../snapshots/72a4fc277c7232110726a3363cb7622f7be63fc3f17c5f520460010f70357979/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'CredentialAvailability',
        columns: [
          col('accountId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('availability', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('fence', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('modelId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('probeExpiresAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('probeId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('providerId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('revision', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('since', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('until', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
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
        table: 'CredentialAvailability',
        constraint: 'CredentialAvailability_userId_accountId_providerId_modelId_key',
        columns: ['userId', 'accountId', 'providerId', 'modelId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'CredentialAvailability',
        foreignKey: {
          name: 'CredentialAvailability_userId_fkey',
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
