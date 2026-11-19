#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1a02b03e9c55a9217a656178deaf1e9cd859f579ee855b15801ba04a1329bbbc/contract';
import startContract from '../../snapshots/1a02b03e9c55a9217a656178deaf1e9cd859f579ee855b15801ba04a1329bbbc/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/b3d260c93b2482a08fb1673253a185d6399e44d37cc1a4b8e0c07c6b04d346bf/contract';
import endContract from '../../snapshots/b3d260c93b2482a08fb1673253a185d6399e44d37cc1a4b8e0c07c6b04d346bf/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';
import { backfillSessionProvider } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('sandboxProvider', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('credentialSource', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('sandboxInstanceId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      backfillSessionProvider,
      this.setNotNull({ schema: 'v2', table: 'V2Session', column: 'sandboxProvider' }),
      this.setNotNull({ schema: 'v2', table: 'V2Session', column: 'credentialSource' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
