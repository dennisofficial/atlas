#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/946def7626177495469475dd9a426226c7de44f7e8e71d88ab4574016887bcdb/contract';
import endContract from '../../snapshots/946def7626177495469475dd9a426226c7de44f7e8e71d88ab4574016887bcdb/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b4d2e89e8a65765912a017f22242339633a03efa5531d3746c5d99550a240aab/contract';
import startContract from '../../snapshots/b4d2e89e8a65765912a017f22242339633a03efa5531d3746c5d99550a240aab/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'SandboxBootStep',
        column: col('outcome', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
