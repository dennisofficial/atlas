import { rawSql } from '@prisma/orm-postgres/migration'

const pullUpdatedAtLabel = 'Backfill GithubPrState.pullUpdatedAt from the row clock'

export const backfillPullUpdatedAt = rawSql({
  id: 'data.pr-state-pull-updated-at',
  label: pullUpdatedAtLabel,
  operationClass: 'data',
  target: {
    id: 'table.GithubPrState',
    details: { schema: 'public', objectType: 'table' as const, name: 'GithubPrState' },
  },
  precheck: [],
  execute: [
    {
      description: pullUpdatedAtLabel,
      sql: `UPDATE "public"."GithubPrState" SET "pullUpdatedAt" = "updatedAt" WHERE "pullUpdatedAt" IS NULL`,
    },
  ],
  postcheck: [],
})

const nextDueAtLabel = 'Seed GithubTrackingTarget.nextDueAt from the attempt clock'

export const backfillNextDueAt = rawSql({
  id: 'data.tracking-target-next-due-at',
  label: nextDueAtLabel,
  operationClass: 'data',
  target: {
    id: 'table.GithubTrackingTarget',
    details: { schema: 'public', objectType: 'table' as const, name: 'GithubTrackingTarget' },
  },
  precheck: [],
  execute: [
    {
      description: nextDueAtLabel,
      sql: `UPDATE "public"."GithubTrackingTarget" SET "nextDueAt" = "attemptedAt" WHERE "attemptedAt" IS NOT NULL`,
    },
  ],
  postcheck: [],
})
