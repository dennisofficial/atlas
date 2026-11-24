#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/826d20353e486a4f5238556f0fe87297523286ced7584b7d0aefe87f90af521b/contract';
import endContract from '../../snapshots/826d20353e486a4f5238556f0fe87297523286ced7584b7d0aefe87f90af521b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e9f5d77490b65583d7e18d14283d066e1104174218be60d5cc672ca276a87e22/contract';
import startContract from '../../snapshots/e9f5d77490b65583d7e18d14283d066e1104174218be60d5cc672ca276a87e22/contract.json' with { type: 'json' };
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
