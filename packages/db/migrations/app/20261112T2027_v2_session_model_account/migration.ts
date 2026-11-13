#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/7ce0c6e07746aaadcecc5813280a9591cb44eef6894cd5d7cb28a8e9782c2d4e/contract';
import endContract from '../../snapshots/7ce0c6e07746aaadcecc5813280a9591cb44eef6894cd5d7cb28a8e9782c2d4e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c6031259b2791244b5c7e8e2ee815047f27ee8417bdde6394dc7ad25e9fa3211/contract';
import startContract from '../../snapshots/c6031259b2791244b5c7e8e2ee815047f27ee8417bdde6394dc7ad25e9fa3211/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('modelAccountId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
