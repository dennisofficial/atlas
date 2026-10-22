import { rawSql } from '@prisma/orm-postgres/migration'

const label = 'Backfill Thread.organizationId from the workspace that owns its project'

export const backfillThreadOwner = rawSql({
  id: 'data.thread-owner-backfill',
  label,
  operationClass: 'data',
  target: { id: 'table.Thread', details: { schema: 'public', objectType: 'table' as const, name: 'Thread' } },
  precheck: [],
  execute: [
    {
      description: label,
      sql: `UPDATE "public"."Thread" AS t SET "organizationId" = p."organizationId" FROM "public"."Project" AS p WHERE t."projectId" = p."id" AND p."organizationId" IS NOT NULL`,
    },
  ],
  postcheck: [],
})
