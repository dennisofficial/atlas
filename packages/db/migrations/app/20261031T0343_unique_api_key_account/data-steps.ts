import { rawSql } from '@prisma/orm-postgres/migration'

const label = 'Keep one api-key AgentAccount per user and provider: the newest, and point the active pointer at it'

export const dedupeApiKeyAccounts = rawSql({
  id: 'data.dedupe-api-key-accounts',
  label,
  operationClass: 'data',
  target: {
    id: 'table.AgentAccount',
    details: { schema: 'public', objectType: 'table' as const, name: 'AgentAccount' },
  },
  precheck: [],
  execute: [
    {
      description: label,
      sql: `UPDATE "public"."ActiveAccount" AS pointer
SET "accountId" = keep."id"
FROM "public"."AgentAccount" AS keep
WHERE keep."kind" = 'api-key'
  AND keep."userId" = pointer."userId"
  AND keep."provider" = pointer."provider"
  AND keep."createdAt" = (
    SELECT MAX(each."createdAt") FROM "public"."AgentAccount" AS each
    WHERE each."kind" = 'api-key' AND each."userId" = pointer."userId" AND each."provider" = pointer."provider"
  )`,
    },
    {
      description: label,
      sql: `DELETE FROM "public"."AgentAccount" AS dup
WHERE dup."kind" = 'api-key'
  AND dup."id" <> (
    SELECT keep."id" FROM "public"."AgentAccount" AS keep
    WHERE keep."kind" = 'api-key' AND keep."userId" = dup."userId" AND keep."provider" = dup."provider"
    ORDER BY keep."createdAt" DESC, keep."id" DESC
    LIMIT 1
  )`,
    },
  ],
  postcheck: [],
})
