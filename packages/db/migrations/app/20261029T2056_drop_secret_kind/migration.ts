#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/a7d41c08974879da5ec02d956fc526de4d5f955818d32119a17019e198d0a159/contract';
import endContract from '../../snapshots/a7d41c08974879da5ec02d956fc526de4d5f955818d32119a17019e198d0a159/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/d23bb282103f356355aa25e6ef1b04f866cf8ec2c86579853d9410d1f7f0831e/contract';
import startContract from '../../snapshots/d23bb282103f356355aa25e6ef1b04f866cf8ec2c86579853d9410d1f7f0831e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropColumn({ schema: 'public', table: 'ProjectSecret', column: 'kind' }),
      this.dropColumn({ schema: 'public', table: 'SecretEntry', column: 'kind' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
