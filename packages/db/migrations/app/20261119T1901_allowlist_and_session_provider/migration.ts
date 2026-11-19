#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/e52acf6e77c1b474cb70a8d424a55b015963913c0b2ca41242fbcf832a7e8b3c/contract';
import endContract from '../../snapshots/e52acf6e77c1b474cb70a8d424a55b015963913c0b2ca41242fbcf832a7e8b3c/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e7fb1deef42a9e3691eb5b183a61acfa5e82d3bbef4ba7ee38382a7ac0b3ef3f/contract';
import startContract from '../../snapshots/e7fb1deef42a9e3691eb5b183a61acfa5e82d3bbef4ba7ee38382a7ac0b3ef3f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';
import { backfillSessionProvider, backfillUserActive } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'User',
        column: col('active', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      backfillUserActive,
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('credentialSource', 'text', {
          notNull: true,
          default: lit('byok'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('sandboxInstanceId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('sandboxProvider', 'text', {
          notNull: true,
          default: lit('vercel'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('sandboxStatus', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('sandboxStatusAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      backfillSessionProvider,
      this.createIndex({
        schema: 'v2',
        table: 'V2Session',
        index: 'V2Session_sandboxInstanceId_idx_c3850fdd',
        columns: ['sandboxInstanceId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
