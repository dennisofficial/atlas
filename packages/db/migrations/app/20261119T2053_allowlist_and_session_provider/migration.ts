#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/4406b81cac8b98381149af5769abd34522833966d2564835450f6715e509fe49/contract';
import endContract from '../../snapshots/4406b81cac8b98381149af5769abd34522833966d2564835450f6715e509fe49/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/bf5971f6734312e26cc52170b6a19be6f0e0f24f0f9d6274f56906d2fc21bb93/contract';
import startContract from '../../snapshots/bf5971f6734312e26cc52170b6a19be6f0e0f24f0f9d6274f56906d2fc21bb93/contract.json' with { type: 'json' };
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
