#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2040fdaad1f6b437ef3fbbe002f96b4f07954f628cc8c799e5b774fb6be69f0f/contract';
import startContract from '../../snapshots/2040fdaad1f6b437ef3fbbe002f96b4f07954f628cc8c799e5b774fb6be69f0f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/41338d269aeb2c3286bf5cd9de9bee50a6368aa813f7ccb5064f009c55f0d340/contract';
import endContract from '../../snapshots/41338d269aeb2c3286bf5cd9de9bee50a6368aa813f7ccb5064f009c55f0d340/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('podActualVcpus', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('podAppliedGeneration', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('podDesiredVcpus', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('podResizeError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('podSizeGeneration', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
