import { db } from '@dltech/atlas-db'

export type LapsedSubscription = { subscriptionId: string; threadId: string }

export async function lapsedSubscriptionsWithThread(args: {
  at: string
}): Promise<LapsedSubscription[]> {
  const rows = await db.query(
    db.raw.sql`
      SELECT held.id AS "subscriptionId", held."threadId" AS "threadId"
      FROM "public"."GithubSubscription" AS held
      WHERE held."threadId" <> ''
        AND (
          held."deadline" < ${args.at}::timestamptz
          OR (held."expiresAt" < ${args.at}::timestamptz AND held."liveUntil" < ${args.at}::timestamptz)
        )
        AND EXISTS (SELECT 1 FROM "v2"."V2Thread" AS thread WHERE thread.id = held."threadId")
    `
      .returnsRow({ subscriptionId: 'pg/text@1', threadId: 'pg/text@1' })
      .build(),
  )
  const lapsed: LapsedSubscription[] = []
  for await (const row of rows)
    lapsed.push({ subscriptionId: row.subscriptionId, threadId: row.threadId })
  return lapsed
}

export async function dropLapsedSubscriptionsWithoutThread(args: { at: string }): Promise<number> {
  const { affectedRows } = await db.execute(
    db.raw.sql`
      DELETE FROM "public"."GithubSubscription" AS held
      WHERE held."threadId" <> ''
        AND held."liveUntil" < ${args.at}::timestamptz
        AND (
          held."deadline" < ${args.at}::timestamptz
          OR held."expiresAt" < ${args.at}::timestamptz
        )
        AND NOT EXISTS (SELECT 1 FROM "v2"."V2Thread" AS thread WHERE thread.id = held."threadId")
    `
      .affectedCount()
      .build(),
  )
  return affectedRows
}
