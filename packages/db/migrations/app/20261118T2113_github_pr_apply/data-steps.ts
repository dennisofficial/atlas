import { rawSql } from '@prisma/orm-postgres/migration'

const label = 'Backfill GithubPrState.pullUpdatedAt from the row clock'

export const backfillPullUpdatedAt = rawSql({
  id: 'data.pr-state-pull-updated-at',
  label,
  operationClass: 'data',
  target: {
    id: 'table.GithubPrState',
    details: { schema: 'public', objectType: 'table' as const, name: 'GithubPrState' },
  },
  precheck: [],
  execute: [
    {
      description: label,
      sql: `UPDATE "public"."GithubPrState" SET "pullUpdatedAt" = "updatedAt" WHERE "pullUpdatedAt" IS NULL`,
    },
  ],
  postcheck: [],
})
