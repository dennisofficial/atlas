#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/797903f7d98c5c4990d8f823d9aaffd5af00b717b65716135c2d3f0e1be7afe7/contract';
import startContract from '../../snapshots/797903f7d98c5c4990d8f823d9aaffd5af00b717b65716135c2d3f0e1be7afe7/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f005b101051af98b8ae70d1fa7bff5df7f9a581c7e6b90c96006761bbe3d2c26/contract';
import endContract from '../../snapshots/f005b101051af98b8ae70d1fa7bff5df7f9a581c7e6b90c96006761bbe3d2c26/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'v2',
        table: 'V2ComposerDraft',
        columns: [
          col('attachments', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('scopeKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('text', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['userId', 'scopeKey'])],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2ComposerDraft',
        index: 'V2ComposerDraft_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.addForeignKey({
        schema: 'v2',
        table: 'V2ComposerDraft',
        foreignKey: {
          name: 'V2ComposerDraft_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'v2', table: 'V2Session', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
