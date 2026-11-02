#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/18518cc2afa8b273ce1fbe178c79fb8ae7141b1872f63117c8606ff5be9eb08f/contract';
import startContract from '../../snapshots/18518cc2afa8b273ce1fbe178c79fb8ae7141b1872f63117c8606ff5be9eb08f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/b7782ac406600db0ef366864169b3abf3a72449cdd7025c573d7515f54a34342/contract';
import endContract from '../../snapshots/b7782ac406600db0ef366864169b3abf3a72449cdd7025c573d7515f54a34342/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: col('checksIgnored', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
