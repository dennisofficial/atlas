import { db } from '@dltech/atlas-db'

export async function claimDeliveries(args: {
  threadId: string
  eventIds: readonly string[]
  leaseUntil: Date
}): Promise<Set<string>> {
  if (args.eventIds.length === 0) return new Set()
  const rows = await db.query(
    db.raw.sql`INSERT INTO "GithubPrEventDelivery" ("eventId", "threadId", "leaseExpiresAt")
        SELECT claimed.id, ${args.threadId}, ${args.leaseUntil.toISOString()}::timestamptz
        FROM jsonb_array_elements_text(${JSON.stringify(args.eventIds)}::jsonb) AS claimed(id)
        ON CONFLICT ("eventId", "threadId") DO UPDATE
          SET "leaseExpiresAt" = EXCLUDED."leaseExpiresAt"
          WHERE "GithubPrEventDelivery"."ackedAt" IS NULL
            AND ("GithubPrEventDelivery"."leaseExpiresAt" IS NULL
              OR "GithubPrEventDelivery"."leaseExpiresAt" < now())
        RETURNING "eventId"`
      .returnsRow({ eventId: 'pg/text@1' })
      .build(),
  )
  const claimed = new Set<string>()
  for await (const row of rows) claimed.add(row.eventId)
  return claimed
}
