#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/18518cc2afa8b273ce1fbe178c79fb8ae7141b1872f63117c8606ff5be9eb08f/contract';
import startContract from '../../snapshots/18518cc2afa8b273ce1fbe178c79fb8ae7141b1872f63117c8606ff5be9eb08f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/254bd86691d48e697948d9fbb8eaf42cfa74accbfe88ccea3a8b3915d32bb7f0/contract';
import endContract from '../../snapshots/254bd86691d48e697948d9fbb8eaf42cfa74accbfe88ccea3a8b3915d32bb7f0/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'Thread',
        column: col('waitingForModel', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
