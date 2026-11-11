#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1143c80ee8dbac2b5a381aa19f5806cfa71c9c3de8e53ffb5f82bd8eef4d80e1/contract';
import endContract from '../../snapshots/1143c80ee8dbac2b5a381aa19f5806cfa71c9c3de8e53ffb5f82bd8eef4d80e1/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/a04df9006767473ac4a56cce0bc21d144268ba24e28d5e1982fc2e71496f36f2/contract';
import startContract from '../../snapshots/a04df9006767473ac4a56cce0bc21d144268ba24e28d5e1982fc2e71496f36f2/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropConstraint({
        schema: 'public',
        table: 'Artifact',
        constraint: 'Artifact_token_key',
      }),
      this.dropColumn({ schema: 'public', table: 'Artifact', column: 'token' }),
      this.dropConstraint({
        schema: 'public',
        table: 'Artifact',
        constraint: 'Artifact_userId_slug_key',
      }),
      this.dropColumn({ schema: 'public', table: 'Artifact', column: 'slug' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
