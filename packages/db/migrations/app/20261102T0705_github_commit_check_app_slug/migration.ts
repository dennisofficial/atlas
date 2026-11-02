#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/712e9415480d7312b1c0679aa42628889abb92f08bf073f4db41d727bba8e240/contract';
import endContract from '../../snapshots/712e9415480d7312b1c0679aa42628889abb92f08bf073f4db41d727bba8e240/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/d5e5a2706e61e5fad472ac8388a376b8687daeed64e300ae3ff8330aa637fc5d/contract';
import startContract from '../../snapshots/d5e5a2706e61e5fad472ac8388a376b8687daeed64e300ae3ff8330aa637fc5d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubCommitCheck',
        column: col('appSlug', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubCommitCheck',
        index: 'GithubCommitCheck_repoFullName_appSlug_idx_27a9561c',
        columns: ['repoFullName', 'appSlug'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
