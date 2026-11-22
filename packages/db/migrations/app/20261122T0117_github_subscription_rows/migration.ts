#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/002ccde9a04c81afe52c0bdcff59c1f67b359a4488f643ef5bd5b4c3e301e321/contract';
import startContract from '../../snapshots/002ccde9a04c81afe52c0bdcff59c1f67b359a4488f643ef5bd5b4c3e301e321/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/41a31a761fa6cd6592e5d4a264897449d932fa00b5c4e72926904248ccde9acb/contract';
import endContract from '../../snapshots/41a31a761fa6cd6592e5d4a264897449d932fa00b5c4e72926904248ccde9acb/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubSubscription',
        column: col('createdBy', 'text', {
          notNull: true,
          default: lit(''),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubSubscription',
        column: col('deadline', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubSubscription',
        column: col('label', 'text', {
          notNull: true,
          default: lit(''),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubSubscription',
        column: col('provider', 'text', {
          notNull: true,
          default: lit(''),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubSubscription',
        column: col('sessionId', 'text', {
          notNull: true,
          default: lit(''),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubSubscription',
        column: col('target', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
