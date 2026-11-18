#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2541e5aede31bb479c8314cd6e503481445a1d16dc7a737c3db677498d1a76bc/contract';
import endContract from '../../snapshots/2541e5aede31bb479c8314cd6e503481445a1d16dc7a737c3db677498d1a76bc/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/88f225cca0b604786460cbaa120b91f0620bb6a929d5a1bafd679674ecc0dd41/contract';
import startContract from '../../snapshots/88f225cca0b604786460cbaa120b91f0620bb6a929d5a1bafd679674ecc0dd41/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubTrackingTarget',
        column: col('attemptedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
