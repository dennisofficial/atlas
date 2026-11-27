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

const writeRefusalOf = (args: { db: Db; id: string; refusal: ServerRefusal }) => {
  const statement = args.db.raw.sql`UPDATE "McpServer"
    SET "oauthRefusal" = ${args.refusal.reason},
        "oauthRefusedAt" = ${args.refusal.at.toISOString()}::timestamptz
    WHERE "id" = ${args.id}`
    .affectedCount()
    .build()
  return args.db.execute(statement)
}

export const setServerRefusal = async (args: {
  db: Db
  id: string
  refusal: ServerRefusal | null
}): Promise<void> => {
  if (args.refusal === null) {
    await clearRefusalOf(args)
    return
  }
  await writeRefusalOf({ db: args.db, id: args.id, refusal: args.refusal })
}
