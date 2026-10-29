#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0f9e1beccbc9d90f3600620a6ab23c0d7b2978b57813c9531f56acd2d57d9ad7/contract';
import startContract from '../../snapshots/0f9e1beccbc9d90f3600620a6ab23c0d7b2978b57813c9531f56acd2d57d9ad7/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/25f527937b651ef80d37bd709e3b809696f9475417e6b889079f399cc70f116c/contract';
import endContract from '../../snapshots/25f527937b651ef80d37bd709e3b809696f9475417e6b889079f399cc70f116c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [...this.renameTable({ schema: 'public', table: 'Session', to: 'AuthSession' })];
  }
}

MigrationCLI.run(import.meta.url, M);
