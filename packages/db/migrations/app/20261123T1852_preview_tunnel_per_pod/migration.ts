#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/797903f7d98c5c4990d8f823d9aaffd5af00b717b65716135c2d3f0e1be7afe7/contract';
import startContract from '../../snapshots/797903f7d98c5c4990d8f823d9aaffd5af00b717b65716135c2d3f0e1be7afe7/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/fff3452e60706e4f7d0cbe1d626add5db258b7e2c0306de14e388e977e573d09/contract';
import endContract from '../../snapshots/fff3452e60706e4f7d0cbe1d626add5db258b7e2c0306de14e388e977e573d09/contract.json' with { type: 'json' };
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
