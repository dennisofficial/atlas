#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/e10afd6f04a655c4be2c0eafdcb177d67f2441abf67ede2e9888844edd9e68ef/contract';
import startContract from '../../snapshots/e10afd6f04a655c4be2c0eafdcb177d67f2441abf67ede2e9888844edd9e68ef/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/fe7026b0bafb2b5365ea4cb7162f26f4060d11115bc29bee8787d1f3d102a2e1/contract';
import endContract from '../../snapshots/fe7026b0bafb2b5365ea4cb7162f26f4060d11115bc29bee8787d1f3d102a2e1/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'v2',
        table: 'V2ChangeBlob',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('hash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('size', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['hash'])],
      }),
      this.createTable({
        schema: 'v2',
        table: 'V2WorktreeChangedFile',
        columns: [
          col('additions', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('baseHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('binary', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('checkoutId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('currentHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('deletions', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('oldPath', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('path', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('size', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['checkoutId', 'path'], { name: 'V2WorktreeChangedFile_pkey' })],
      }),
      this.createTable({
        schema: 'v2',
        table: 'V2WorktreeChanges',
        columns: [
          col('base', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('fingerprint', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('repo', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('worktreePath', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2ChangeBlob',
        index: 'V2ChangeBlob_createdAt_idx_9575dbd7',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2WorktreeChangedFile',
        index: 'V2WorktreeChangedFile_baseHash_idx_4f00325f',
        columns: ['baseHash'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2WorktreeChangedFile',
        index: 'V2WorktreeChangedFile_currentHash_idx_4da01d65',
        columns: ['currentHash'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2WorktreeChanges',
        index: 'V2WorktreeChanges_sessionId_idx',
        columns: ['sessionId', 'updatedAt'],
      }),
      this.addForeignKey({
        schema: 'v2',
        table: 'V2WorktreeChangedFile',
        foreignKey: {
          name: 'V2WorktreeChangedFile_checkoutId_fkey',
          columns: ['checkoutId'],
          references: { schema: 'v2', table: 'V2WorktreeChanges', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'v2',
        table: 'V2WorktreeChanges',
        foreignKey: {
          name: 'V2WorktreeChanges_sessionId_fkey',
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
