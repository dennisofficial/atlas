import { rawSql } from '@prisma/orm-postgres/migration'

const label = 'Backfill User.active = true for existing users'

export const backfillUserActive = rawSql({
  id: 'data.user-active-backfill',
  label,
  operationClass: 'data',
  target: {
    id: 'table.User',
    details: { schema: 'public', objectType: 'table' as const, name: 'User' },
  },
  precheck: [],
  execute: [
    {
      description: label,
      sql: `UPDATE "public"."User" SET "active" = true WHERE "active" = false`,
    },
  ],
  postcheck: [],
})
