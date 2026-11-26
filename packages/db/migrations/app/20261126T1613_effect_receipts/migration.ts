#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/a1f6bd3f6d5954509850c76a50edbf8fed7bbc538a59236914fccf34eb806f5b/contract';
import startContract from '../../snapshots/a1f6bd3f6d5954509850c76a50edbf8fed7bbc538a59236914fccf34eb806f5b/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c779b18d69fd0e645aa1ed3e4d552bf07119a0f8e3425748b58e06b81715798b/contract';
import endContract from '../../snapshots/c779b18d69fd0e645aa1ed3e4d552bf07119a0f8e3425748b58e06b81715798b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'EffectReceipt',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('result', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('stepKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('threadId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['threadId', 'stepKey'], { name: 'EffectReceipt_pkey' })],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
