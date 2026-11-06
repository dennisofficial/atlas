#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/41eb9776117c6b638bf351597741640c89954131da999dbe999dd15e05a5d04d/contract';
import startContract from '../../snapshots/41eb9776117c6b638bf351597741640c89954131da999dbe999dd15e05a5d04d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/4ee46c5fd44c6032a6b2da39abbe149828438e06f5b1f9adf3b3ada3e7fe7c36/contract';
import endContract from '../../snapshots/4ee46c5fd44c6032a6b2da39abbe149828438e06f5b1f9adf3b3ada3e7fe7c36/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'PushDevice',
        column: col('authSessionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'PushDevice',
        index: 'PushDevice_authSessionId_idx',
        columns: ['authSessionId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
