#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/17fdd443010a9232bdff773e7dd760e7c05cba76ae897be0dcaba4f49b8006ec/contract';
import startContract from '../../snapshots/17fdd443010a9232bdff773e7dd760e7c05cba76ae897be0dcaba4f49b8006ec/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/5d41567370b5e736a31c85389975b7b06ea26645fe953dd7873182b15715a0ee/contract';
import endContract from '../../snapshots/5d41567370b5e736a31c85389975b7b06ea26645fe953dd7873182b15715a0ee/contract.json' with { type: 'json' };
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
