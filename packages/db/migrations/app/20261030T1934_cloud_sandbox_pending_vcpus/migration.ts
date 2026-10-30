#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/766fe5d981ef8812a04c115efa55f409c9b820fcf307a9c8b8aae721d401adbb/contract';
import endContract from '../../snapshots/766fe5d981ef8812a04c115efa55f409c9b820fcf307a9c8b8aae721d401adbb/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/80d413755dd13ad67ff66f9633530718bc157c37bb693509cbc2b52ccf0b3f71/contract';
import startContract from '../../snapshots/80d413755dd13ad67ff66f9633530718bc157c37bb693509cbc2b52ccf0b3f71/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'CloudSandbox',
        column: col('pendingVcpus', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
