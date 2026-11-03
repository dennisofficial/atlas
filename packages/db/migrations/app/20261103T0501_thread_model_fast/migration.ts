#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0f01c00d02783fa0b4af02e4ac7200a9fd602d97f2b8975e3092818324485a21/contract';
import startContract from '../../snapshots/0f01c00d02783fa0b4af02e4ac7200a9fd602d97f2b8975e3092818324485a21/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/7a7a0970243dce02319d461c9fa8529535ad94488bba092dd38e313a6b109939/contract';
import endContract from '../../snapshots/7a7a0970243dce02319d461c9fa8529535ad94488bba092dd38e313a6b109939/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'Thread',
        column: col('modelFast', 'bool', { codecRef: { codecId: 'pg/bool@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
