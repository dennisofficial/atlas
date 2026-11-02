#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/18518cc2afa8b273ce1fbe178c79fb8ae7141b1872f63117c8606ff5be9eb08f/contract';
import startContract from '../../snapshots/18518cc2afa8b273ce1fbe178c79fb8ae7141b1872f63117c8606ff5be9eb08f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f2fa6a70708311107e8f5fc3dc833f2d483bea83dfe049196ed6468b254192df/contract';
import endContract from '../../snapshots/f2fa6a70708311107e8f5fc3dc833f2d483bea83dfe049196ed6468b254192df/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'v2' }),
      this.createTable({
        schema: 'v2',
        table: 'V2Event',
        columns: [
          col('at', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('canonical', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('epoch', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('hash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('prevHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('runId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('seq', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('threadId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['threadId', 'seq'], { name: 'V2Event_pkey' })],
      }),
      this.createTable({
        schema: 'v2',
        table: 'V2InboxEntry',
        columns: [
          col('consumedSeq', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('inboxId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('postedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['sessionId', 'inboxId'], { name: 'V2InboxEntry_pkey' })],
      }),
      this.createTable({
        schema: 'v2',
        table: 'V2Lease',
        columns: [
          col('epoch', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('holderId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('renewedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ttlMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['sessionId'])],
      }),
      this.createTable({
        schema: 'v2',
        table: 'V2Session',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('nextInboxId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'v2',
        table: 'V2Thread',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('headHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('headSeq', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('visibility', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'v2',
        table: 'V2Event',
        constraint: 'V2Event_id_key',
        columns: ['id'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2Event',
        index: 'V2Event_threadId_type_seq_idx',
        columns: ['threadId', 'type', 'seq'],
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2Thread',
        index: 'V2Thread_sessionId_idx',
        columns: ['sessionId'],
      }),
      this.addForeignKey({
        schema: 'v2',
        table: 'V2Event',
        foreignKey: {
          name: 'V2Event_threadId_fkey',
          columns: ['threadId'],
          references: { schema: 'v2', table: 'V2Thread', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'v2',
        table: 'V2InboxEntry',
        foreignKey: {
          name: 'V2InboxEntry_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'v2', table: 'V2Session', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'v2',
        table: 'V2Lease',
        foreignKey: {
          name: 'V2Lease_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'v2', table: 'V2Session', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'v2',
        table: 'V2Thread',
        foreignKey: {
          name: 'V2Thread_sessionId_fkey',
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
