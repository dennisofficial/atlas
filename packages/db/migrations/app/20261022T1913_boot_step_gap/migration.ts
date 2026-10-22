#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/652eda18865caeb7c4d12898fc475837af9bfedf38aed15cb3f1041db4729364/contract';
import startContract from '../../snapshots/652eda18865caeb7c4d12898fc475837af9bfedf38aed15cb3f1041db4729364/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/9f7bf2b0da764a13cf6bcb46cbb59a8905c8d7f20bdb54ef68455d72613703b0/contract';
import endContract from '../../snapshots/9f7bf2b0da764a13cf6bcb46cbb59a8905c8d7f20bdb54ef68455d72613703b0/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'SandboxBootStep',
        column: col('gap', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
