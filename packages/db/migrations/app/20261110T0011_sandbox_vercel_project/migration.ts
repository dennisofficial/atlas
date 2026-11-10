#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1440ea06adc82bfb24c1b7d40dc3fc4a31df6691444f3237fb72c7a072b29df7/contract';
import endContract from '../../snapshots/1440ea06adc82bfb24c1b7d40dc3fc4a31df6691444f3237fb72c7a072b29df7/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/31919bc07e05f8bd7cdba3993d5e8d4da55238cdb6046ca1a203c484218b01ab/contract';
import startContract from '../../snapshots/31919bc07e05f8bd7cdba3993d5e8d4da55238cdb6046ca1a203c484218b01ab/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';
import { backfillSandboxVercelProjectId } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'CloudSandbox',
        column: col('vercelProjectId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      backfillSandboxVercelProjectId,
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
