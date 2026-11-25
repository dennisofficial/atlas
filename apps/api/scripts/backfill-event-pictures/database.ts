import { SQL } from 'bun'

import type { Hash, MediaRef } from '@dltech/atlas-core'

import type { ChainedEventRow } from './rewrite'

export type EventRow = {
  threadId: string
  seq: number
  id: string
  epoch: number
  type: string
  runId: string
  at: string | Date
  prevHash: string
  hash: string
  canonical: string
}

export type AffectedThread = {
  threadId: string
  sessionId: string
  userId: string
  firstSeq: number
}

export type ThreadHead = { headSeq: number; headHash: string }

export type ApplyOutcome = { kind: 'applied' } | { kind: 'busy' } | { kind: 'moved' }

const EVENT_COLUMNS =
  '"threadId", "seq", "id", "epoch", "type", "runId", "at", "prevHash", "hash", "canonical"'

export const openDb = (url: string): SQL => new SQL(url)

export const affectedThreads = async (args: {
  sql: SQL
  threadId?: string | undefined
}): Promise<AffectedThread[]> => {
  const filter = args.threadId === undefined ? '' : 'AND e."threadId" = $1'
  const rows = await args.sql.unsafe(
    `SELECT e."threadId", t."sessionId", s."userId", MIN(e."seq")::int AS "firstSeq"
     FROM "public"."Event" e
     JOIN "public"."Thread" t ON t."id" = e."threadId"
     JOIN "public"."Session" s ON s."id" = t."sessionId"
     WHERE e."type" = 'tool-result'
       AND (e."canonical" LIKE '%"kind":"inline"%'
         OR (e."canonical" LIKE '%"type":"image"%'
           AND e."canonical" LIKE '%"mimeType":"%'
           AND e."canonical" LIKE '%"data":"%'))
       ${filter}
     GROUP BY e."threadId", t."sessionId", s."userId"
     ORDER BY MIN(e."seq")`,
    args.threadId === undefined ? [] : [args.threadId],
  )
  return rows as AffectedThread[]
}

export const readHead = async (args: { sql: SQL; threadId: string }): Promise<ThreadHead> => {
  const rows = await args.sql.unsafe(
    'SELECT "headSeq", "headHash" FROM "public"."Thread" WHERE "id" = $1',
    [args.threadId],
  )
  const head = rows[0] as ThreadHead | undefined
  if (head === undefined) throw new Error(`thread ${args.threadId} has no row`)
  return head
}

export const readHolder = async (args: { sql: SQL; sessionId: string }): Promise<number | null> => {
  const rows = await args.sql.unsafe(
    'SELECT "holderHostId" FROM "public"."Lease" WHERE "sessionId" = $1',
    [args.sessionId],
  )
  return (rows[0] as { holderHostId: number | null } | undefined)?.holderHostId ?? null
}

export const readRows = async (args: {
  sql: SQL
  threadId: string
  fromSeq: number
}): Promise<EventRow[]> =>
  (await args.sql.unsafe(
    `SELECT ${EVENT_COLUMNS} FROM "public"."Event"
     WHERE "threadId" = $1 AND "seq" >= $2 ORDER BY "seq" ASC`,
    [args.threadId, args.fromSeq],
  )) as EventRow[]

export const ensureArchive = async (args: { sql: SQL }): Promise<void> => {
  await args.sql.unsafe('CREATE SCHEMA IF NOT EXISTS archive')
  await args.sql.unsafe(
    `CREATE TABLE IF NOT EXISTS archive."EventPictures20261125" (
       LIKE "public"."Event" INCLUDING DEFAULTS,
       PRIMARY KEY ("threadId", "seq")
     )`,
  )
}

export const mediaExists = async (args: {
  sql: SQL
  userId: string
  hash: string
}): Promise<boolean> => {
  const rows = await args.sql.unsafe(
    'SELECT 1 FROM "public"."Media" WHERE "userId" = $1 AND "hash" = $2',
    [args.userId, args.hash],
  )
  return rows.length > 0
}

export const insertMedia = async (args: {
  sql: SQL
  userId: string
  media: MediaRef
}): Promise<void> => {
  const { hash, mediaType, size, width, height } = args.media
  await args.sql.unsafe(
    `INSERT INTO "public"."Media" ("userId", "hash", "mediaType", "size", "width", "height")
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT ("userId", "hash") DO NOTHING`,
    [args.userId, hash, mediaType, size, width, height],
  )
}

const recreateAppendOnlyTrigger = async (tx: SQL): Promise<void> => {
  await tx.unsafe('DROP TRIGGER "Event_append_only" ON "public"."Event"')
  await tx.unsafe(
    `CREATE TRIGGER "Event_append_only"
     BEFORE UPDATE OR DELETE ON "public"."Event"
     FOR EACH ROW EXECUTE FUNCTION public."Event_append_only"()`,
  )
}

export const applyRewrite = async (args: {
  sql: SQL
  threadId: string
  sessionId: string
  expected: ThreadHead
  archiveFrom: number
  archiveThrough: number
  rows: readonly ChainedEventRow[]
  headHash: Hash
}): Promise<ApplyOutcome> =>
  args.sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL lock_timeout = '3s'`)
    const leases = await tx.unsafe(
      'SELECT "holderHostId" FROM "public"."Lease" WHERE "sessionId" = $1 FOR UPDATE',
      [args.sessionId],
    )
    if ((leases[0] as { holderHostId: number | null } | undefined)?.holderHostId != null)
      return { kind: 'busy' } as const
    const heads = await tx.unsafe(
      'SELECT "headSeq", "headHash" FROM "public"."Thread" WHERE "id" = $1 FOR NO KEY UPDATE',
      [args.threadId],
    )
    const head = heads[0] as ThreadHead | undefined
    if (
      head === undefined ||
      head.headSeq !== args.expected.headSeq ||
      head.headHash !== args.expected.headHash
    )
      return { kind: 'moved' } as const
    await tx.unsafe('UPDATE "public"."Lease" SET "epoch" = "epoch" + 1 WHERE "sessionId" = $1', [
      args.sessionId,
    ])
    await tx.unsafe(
      `INSERT INTO archive."EventPictures20261125"
       SELECT ${EVENT_COLUMNS} FROM "public"."Event"
       WHERE "threadId" = $1 AND "seq" BETWEEN $2 AND $3
       ON CONFLICT ("threadId", "seq") DO NOTHING`,
      [args.threadId, args.archiveFrom, args.archiveThrough],
    )
    await recreateAppendOnlyTrigger(tx)
    for (const row of args.rows) {
      await tx.unsafe(
        `UPDATE "public"."Event" SET "prevHash" = $1, "hash" = $2, "canonical" = $3
         WHERE "threadId" = $4 AND "seq" = $5`,
        [row.prevHash, row.hash, row.canonical, args.threadId, row.seq],
      )
    }
    await tx.unsafe('UPDATE "public"."Thread" SET "headHash" = $1 WHERE "id" = $2', [
      args.headHash,
      args.threadId,
    ])
    return { kind: 'applied' } as const
  })
