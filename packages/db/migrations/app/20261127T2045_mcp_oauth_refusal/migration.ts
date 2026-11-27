#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0afeeb830835c1a111e5003744b1fb67e0fa0e1f89e6213b0ef2535adc60966f/contract';
import endContract from '../../snapshots/0afeeb830835c1a111e5003744b1fb67e0fa0e1f89e6213b0ef2535adc60966f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/16728f3bc2230e97bb7643a13fa9505d4e74bff2ae34f3336296bf1e287cef18/contract';
import startContract from '../../snapshots/16728f3bc2230e97bb7643a13fa9505d4e74bff2ae34f3336296bf1e287cef18/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'McpServer',
        column: col('oauthRefusal', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'McpServer',
        column: col('oauthRefusedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
