import { rawSql } from '@prisma/orm-postgres/migration'

const label =
  'Backfill CloudSandbox.vercelProjectId from the owning user\'s current Vercel project so sandboxes made before the column existed stay reachable when that credential moves to another project'

export const backfillSandboxVercelProjectId = rawSql({
  id: 'data.sandbox-vercel-project-id-backfill',
  invariantId: 'sandbox-vercel-project-id-backfill',
  label,
  operationClass: 'data',
  target: {
    id: 'table.CloudSandbox',
    details: { schema: 'public', objectType: 'table' as const, name: 'CloudSandbox' },
  },
  precheck: [],
  execute: [
    {
      description: label,
      sql: `UPDATE "public"."CloudSandbox" AS b
SET "vercelProjectId" = c."vercelProjectId"
FROM "public"."UserVercelCredential" AS c
WHERE c."userId" = b."userId" AND c."vercelProjectId" IS NOT NULL AND b."vercelProjectId" IS NULL`,
    },
  ],
  postcheck: [],
})
