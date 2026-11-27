import type { Db } from '@dltech/atlas-db'

export type ServerRefusal = { reason: string; at: Date }

const clearRefusalOf = (args: { db: Db; id: string }) => {
  const statement = args.db.raw.sql`UPDATE "McpServer"
    SET "oauthRefusal" = NULL,
        "oauthRefusedAt" = NULL
    WHERE "id" = ${args.id}`
    .affectedCount()
    .build()
  return args.db.execute(statement)
}

const writeRefusalOf = (args: {
  db: Db
  id: string
  refusal: ServerRefusal
  pendingId: string
}) => {
  const statement = args.db.raw.sql`UPDATE "McpServer"
    SET "oauthRefusal" = ${args.refusal.reason},
        "oauthRefusedAt" = ${args.refusal.at.toISOString()}::timestamptz
    WHERE "id" = ${args.id}
      AND NOT EXISTS (
        SELECT 1 FROM "McpOauthPending" AS newer
        WHERE newer."mcpServerId" = ${args.id}
          AND newer."id" <> ${args.pendingId}
          AND newer."createdAt" > (
            SELECT attempt."createdAt" FROM "McpOauthPending" AS attempt
            WHERE attempt."id" = ${args.pendingId}
          )
      )`
    .affectedCount()
    .build()
  return args.db.execute(statement)
}

export const clearServerRefusal = async (args: { db: Db; id: string }): Promise<void> => {
  await clearRefusalOf(args)
}

export const refuseLatestAttempt = async (args: {
  db: Db
  id: string
  refusal: ServerRefusal
  pendingId: string
}): Promise<void> => {
  await writeRefusalOf(args)
}
