import { rawSql } from '@prisma/orm-postgres/migration'

const label = 'Seed GithubTrackingTarget.nextDueAt from the attempt clock'

export const backfillNextDueAt = rawSql({
  id: 'data.tracking-target-next-due-at',
  label,
  operationClass: 'data',
  target: {
    id: 'table.GithubTrackingTarget',
    details: { schema: 'public', objectType: 'table' as const, name: 'GithubTrackingTarget' },
  },
  precheck: [],
  execute: [
    {
      description: label,
      sql: `UPDATE "public"."GithubTrackingTarget" SET "nextDueAt" = "attemptedAt" WHERE "attemptedAt" IS NOT NULL`,
    },
  ],
  postcheck: [],
})
