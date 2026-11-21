#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0d62c39cccfa8cb76d6624ab0c85220e10fc31393e8e0b67bc9d63126e29d03d/contract';
import endContract from '../../snapshots/0d62c39cccfa8cb76d6624ab0c85220e10fc31393e8e0b67bc9d63126e29d03d/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/146b406219be1abe18c62f1a1110703555fc61a7afece7555a592afb45e52c4b/contract';
import startContract from '../../snapshots/146b406219be1abe18c62f1a1110703555fc61a7afece7555a592afb45e52c4b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('sandboxStatusReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
