#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0834414e0459aa522b528ad39c1e21aa6c956e9acaab3ea39fda62a03f21d075/contract';
import startContract from '../../snapshots/0834414e0459aa522b528ad39c1e21aa6c956e9acaab3ea39fda62a03f21d075/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/292d82c5be7099f0bfe0b7d0f90318a461ef4f9d2db7b3f5dd698c44e6ace17d/contract';
import endContract from '../../snapshots/292d82c5be7099f0bfe0b7d0f90318a461ef4f9d2db7b3f5dd698c44e6ace17d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubPrState',
        column: col('checksIgnored', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
