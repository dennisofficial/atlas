#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0834414e0459aa522b528ad39c1e21aa6c956e9acaab3ea39fda62a03f21d075/contract';
import endContract from '../../snapshots/0834414e0459aa522b528ad39c1e21aa6c956e9acaab3ea39fda62a03f21d075/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/18518cc2afa8b273ce1fbe178c79fb8ae7141b1872f63117c8606ff5be9eb08f/contract';
import startContract from '../../snapshots/18518cc2afa8b273ce1fbe178c79fb8ae7141b1872f63117c8606ff5be9eb08f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'CloudSandbox',
        column: col('runningServeVersion', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
