import { rawSql } from '@prisma/orm-postgres/migration'

const label = 'Backfill V2Session sandboxProvider = vercel and credentialSource = byok'

export const backfillSessionProvider = rawSql({
  id: 'data.v2-session-provider-backfill',
  label,
  operationClass: 'data',
  target: {
    id: 'table.V2Session',
    details: { schema: 'v2', objectType: 'table' as const, name: 'V2Session' },
  },
  precheck: [],
  execute: [
    {
      description: label,
      sql: `UPDATE "v2"."V2Session" AS s
SET "sandboxProvider" = COALESCE(s."sandboxProvider", 'vercel'),
    "credentialSource" = COALESCE(s."credentialSource", 'byok')
WHERE s."sandboxProvider" IS NULL OR s."credentialSource" IS NULL`,
    },
  ],
  postcheck: [],
})
