#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/083160e4eedef6a7f27b947e55e638fbfdf83d71400630227fde2da17b5597ce/contract';
import endContract from '../../snapshots/083160e4eedef6a7f27b947e55e638fbfdf83d71400630227fde2da17b5597ce/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/7a7a0970243dce02319d461c9fa8529535ad94488bba092dd38e313a6b109939/contract';
import startContract from '../../snapshots/7a7a0970243dce02319d461c9fa8529535ad94488bba092dd38e313a6b109939/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createIndex({
        schema: 'public',
        table: 'GithubCommitCheck',
        index: 'GithubCommitCheck_runner_apps_f6758591',
        columns: ['repoFullName', 'appSlug'],
        extras: { where: sql`(("checkKey" LIKE 'run:%') AND ("appSlug" IS NOT NULL))` },
      }),
      this.createIndex({
        schema: 'public',
        table: 'GithubPrState',
        index: 'GithubPrState_headSha_idx_5568eb6c',
        columns: ['headSha'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
