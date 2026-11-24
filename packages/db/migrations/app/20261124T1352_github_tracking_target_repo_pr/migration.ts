#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/974071b9738acba06ec97c43b3b772d4a1d30c3e736601bb053e8bb5156698ae/contract';
import startContract from '../../snapshots/974071b9738acba06ec97c43b3b772d4a1d30c3e736601bb053e8bb5156698ae/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f14deed4b0f53291f5db262e9f79d1b19487fd654b4842787af371390390c4bd/contract';
import endContract from '../../snapshots/f14deed4b0f53291f5db262e9f79d1b19487fd654b4842787af371390390c4bd/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createIndex({
        schema: 'public',
        table: 'GithubTrackingTarget',
        index: 'GithubTrackingTarget_repoFullName_prNumber_idx',
        columns: ['repoFullName', 'prNumber'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
