#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5d41567370b5e736a31c85389975b7b06ea26645fe953dd7873182b15715a0ee/contract';
import startContract from '../../snapshots/5d41567370b5e736a31c85389975b7b06ea26645fe953dd7873182b15715a0ee/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/ec07878e1d08550f2bcb55b07c24a180003a9c896bb28f73b2bd9b67cd202325/contract';
import endContract from '../../snapshots/ec07878e1d08550f2bcb55b07c24a180003a9c896bb28f73b2bd9b67cd202325/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, sql } from '@prisma/orm-postgres/migration';
import { deletePreviewRows } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      ...deletePreviewRows,
      this.dropConstraint({
        schema: 'public',
        table: 'PreviewTunnel',
        constraint: 'PreviewTunnel_threadId_key',
      }),
      this.dropColumn({ schema: 'public', table: 'PreviewTunnel', column: 'threadId' }),
      this.addColumn({
        schema: 'public',
        table: 'PreviewTunnel',
        column: col('lastError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'PreviewTunnel',
        column: col('state', 'text', {
          notNull: true,
          default: lit('Pending'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'PreviewTunnel',
        column: col('syncedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.dropNotNull({ schema: 'public', table: 'PreviewRoute', column: 'dnsRecordId' }),
      this.setDefault({
        schema: 'public',
        table: 'PreviewTunnel',
        column: col('sealedTunnelToken', 'text', {
          default: lit(''),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.setDefault({
        schema: 'public',
        table: 'PreviewTunnel',
        column: col('tunnelId', 'text', { default: lit(''), codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumnWithTemporaryDefault({
        schema: 'public',
        table: 'PreviewRoute',
        column: 'updatedAt',
        type: 'timestamptz(3)',
        temporaryDefault: sql`'epoch'`,
      }),
      this.addColumnWithTemporaryDefault({
        schema: 'public',
        table: 'PreviewTunnel',
        column: 'createdByThreadId',
        type: 'text',
        temporaryDefault: sql`''`,
      }),
      this.addRequiredColumnToEmptyTable({
        schema: 'public',
        table: 'PreviewTunnel',
        column: 'podSessionId',
        type: 'text',
      }),
      this.addUnique({
        schema: 'public',
        table: 'PreviewTunnel',
        constraint: 'PreviewTunnel_podSessionId_key',
        columns: ['podSessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'PreviewTunnel',
        index: 'PreviewTunnel_state_idx',
        columns: ['state'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
