import { rawSql } from '@prisma/orm-postgres/migration'

const activeLabel = 'Backfill User.active = true for existing users'

export const backfillUserActive = rawSql({
  id: 'data.user-active-backfill',
  label: activeLabel,
  operationClass: 'data',
  target: {
    id: 'table.User',
    details: { schema: 'public', objectType: 'table' as const, name: 'User' },
  },
  precheck: [],
  execute: [
    {
      description: activeLabel,
      sql: `UPDATE "public"."User" SET "active" = true WHERE "active" = false`,
    },
  ],
  postcheck: [],
})

const providerLabel = 'Backfill V2Session sandboxProvider = vercel and credentialSource = byok'

export const backfillSessionProvider = rawSql({
  id: 'data.v2-session-provider-backfill',
  label: providerLabel,
  operationClass: 'data',
  target: {
    id: 'table.V2Session',
    details: { schema: 'v2', objectType: 'table' as const, name: 'V2Session' },
  },
  precheck: [],
  execute: [
    {
      description: providerLabel,
      sql: `UPDATE "v2"."V2Session" AS s
SET "sandboxProvider" = COALESCE(s."sandboxProvider", 'vercel'),
    "credentialSource" = COALESCE(s."credentialSource", 'byok')
WHERE s."sandboxProvider" IS NULL OR s."credentialSource" IS NULL`,
    },
  ],
  postcheck: [],
})
