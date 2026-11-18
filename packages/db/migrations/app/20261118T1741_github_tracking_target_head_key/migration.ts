#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1add8b8b9f6b1ff3f18634749b5027921128d81a95a5cd7514fa8ae269324f77/contract';
import startContract from '../../snapshots/1add8b8b9f6b1ff3f18634749b5027921128d81a95a5cd7514fa8ae269324f77/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/88f225cca0b604786460cbaa120b91f0620bb6a929d5a1bafd679674ecc0dd41/contract';
import endContract from '../../snapshots/88f225cca0b604786460cbaa120b91f0620bb6a929d5a1bafd679674ecc0dd41/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, rawSql } from '@prisma/orm-postgres/migration';

const backfillHeadPrNumber = rawSql({
  id: 'data.github-tracking-target-head-pr-number',
  label: 'Give every head tracking target the zero PR number its unique key now needs',
  operationClass: 'data',
  target: {
    id: 'table.GithubTrackingTarget',
    details: { schema: 'public', objectType: 'table' as const, name: 'GithubTrackingTarget' },
  },
  precheck: [],
  execute: [
    {
      description: 'Backfill GithubTrackingTarget.prNumber',
      sql: `UPDATE "public"."GithubTrackingTarget" SET "prNumber" = 0 WHERE "prNumber" IS NULL`,
    },
  ],
  postcheck: [],
});

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      backfillHeadPrNumber,
      this.setNotNull({ schema: 'public', table: 'GithubTrackingTarget', column: 'prNumber' }),
      this.setDefault({
        schema: 'public',
        table: 'GithubTrackingTarget',
        column: col('prNumber', 'int4', { default: lit(0), codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
