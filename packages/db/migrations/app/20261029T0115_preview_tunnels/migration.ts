#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4dd6b4ae96e6bac6c84a30e83894c3ac0c8f3e48c43a22bcbc5841ee7ce35210/contract';
import startContract from '../../snapshots/4dd6b4ae96e6bac6c84a30e83894c3ac0c8f3e48c43a22bcbc5841ee7ce35210/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/b4d2e89e8a65765912a017f22242339633a03efa5531d3746c5d99550a240aab/contract';
import endContract from '../../snapshots/b4d2e89e8a65765912a017f22242339633a03efa5531d3746c5d99550a240aab/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'PreviewRoute',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('dnsRecordId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('hostname', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('port', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('previewTunnelId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'PreviewTunnel',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sealedTunnelToken', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('threadId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tunnelId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
        table: 'PreviewRoute',
        constraint: 'PreviewRoute_previewTunnelId_port_key',
        columns: ['previewTunnelId', 'port'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'PreviewTunnel',
        constraint: 'PreviewTunnel_threadId_key',
        columns: ['threadId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'PreviewRoute',
        index: 'PreviewRoute_previewTunnelId_idx_a8997909',
        columns: ['previewTunnelId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'PreviewTunnel',
        index: 'PreviewTunnel_userId_idx',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'PreviewRoute',
        foreignKey: {
          name: 'PreviewRoute_previewTunnelId_fkey',
          columns: ['previewTunnelId'],
          references: { schema: 'public', table: 'PreviewTunnel', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'PreviewTunnel',
        foreignKey: {
          name: 'PreviewTunnel_userId_fkey',
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
