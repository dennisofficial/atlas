#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/65d02fc990c733d3676e480ab5bd6af2247c27ad5a181f8083099cecbdf7bf08/contract';
import startContract from '../../snapshots/65d02fc990c733d3676e480ab5bd6af2247c27ad5a181f8083099cecbdf7bf08/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f9d1545e96be8e862d435b7b8e1f6e87f907a2cec641ec26742b6c0e93726e5e/contract';
import endContract from '../../snapshots/f9d1545e96be8e862d435b7b8e1f6e87f907a2cec641ec26742b6c0e93726e5e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubCommitCheck',
        column: col('detailsUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubCommitCheck',
        column: col('summary', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubCommitCheck',
        column: col('title', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
