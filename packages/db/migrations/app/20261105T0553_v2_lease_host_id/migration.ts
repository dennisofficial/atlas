#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/90a3934f5cbc3a945710f8efd4dea6beaa9df0440ddd84f4888e89b711a00e4d/contract';
import startContract from '../../snapshots/90a3934f5cbc3a945710f8efd4dea6beaa9df0440ddd84f4888e89b711a00e4d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f35adc786c78bd210a084bb4842db0ff8a17a5d01ac78ff2cbac99e9cd3fe642/contract';
import endContract from '../../snapshots/f35adc786c78bd210a084bb4842db0ff8a17a5d01ac78ff2cbac99e9cd3fe642/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropColumn({ schema: 'v2', table: 'V2Lease', column: 'holderId' }),
      this.dropColumn({ schema: 'v2', table: 'V2Lease', column: 'renewedAt' }),
      this.dropColumn({ schema: 'v2', table: 'V2Lease', column: 'ttlMs' }),
      this.addColumn({
        schema: 'v2',
        table: 'V2Lease',
        column: col('holderHostId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
