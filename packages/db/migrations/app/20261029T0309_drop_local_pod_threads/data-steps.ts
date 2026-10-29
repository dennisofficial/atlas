import { rawSql } from '@prisma/orm-postgres/migration'

const label = 'Delete local-pod threads and their sub-agent threads before their checkpoint table is dropped'

export const deleteLocalPodThreads = rawSql({
  id: 'data.delete-local-pod-threads',
  label,
  operationClass: 'data',
  target: { id: 'table.Thread', details: { schema: 'public', objectType: 'table' as const, name: 'Thread' } },
  precheck: [],
  execute: [
    {
      description: label,
      sql: `WITH RECURSIVE doomed AS (
  SELECT t."id" FROM "public"."Thread" t
  WHERE t."id" IN (SELECT "threadId" FROM "public"."LocalPodLease")
  UNION
  SELECT c."id" FROM "public"."Thread" c JOIN doomed d ON c."spawnerThreadId" = d."id"
)
DELETE FROM "public"."Thread" WHERE "id" IN (SELECT "id" FROM doomed)`,
    },
  ],
  postcheck: [],
})
