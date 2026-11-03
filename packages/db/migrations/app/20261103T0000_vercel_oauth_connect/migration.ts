#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0f01c00d02783fa0b4af02e4ac7200a9fd602d97f2b8975e3092818324485a21/contract';
import endContract from '../../snapshots/0f01c00d02783fa0b4af02e4ac7200a9fd602d97f2b8975e3092818324485a21/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/712e9415480d7312b1c0679aa42628889abb92f08bf073f4db41d727bba8e240/contract';
import startContract from '../../snapshots/712e9415480d7312b1c0679aa42628889abb92f08bf073f4db41d727bba8e240/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'UserVercelCredential',
        column: col('accessTokenExpiresAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'UserVercelCredential',
        column: col('kind', 'text', {
          notNull: true,
          default: lit('token'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'UserVercelCredential',
        column: col('oauthNeedsReconnect', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'UserVercelCredential',
        column: col('plan', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'UserVercelCredential',
        column: col('planCheckedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'UserVercelCredential',
        column: col('sealedRefreshToken', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'UserVercelCredential',
        column: col('vercelUserId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.dropNotNull({
        schema: 'public',
        table: 'UserVercelCredential',
        column: 'vercelProjectId',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
