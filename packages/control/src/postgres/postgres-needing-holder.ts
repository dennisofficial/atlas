import type { Tx } from '@dltech/atlas-db'

export const sessionsNeedingHolderIn = async (params: {
  tx: Tx
  now: string
  limit: number
}): Promise<string[]> => {
  const rows = await params.tx.query(
    params.tx.raw.sql`SELECT s."id" FROM "v2"."V2Session" s
        LEFT JOIN "v2"."V2Lease" l ON l."sessionId" = s."id"
        WHERE (l."sessionId" IS NULL OR l."holderId" IS NULL
            OR l."renewedAt" + make_interval(secs => l."ttlMs" / 1000.0) <= ${params.now}::timestamptz)
          AND (l."holderId" IS NOT NULL OR l."wantsHolder"
            OR EXISTS (SELECT 1 FROM "v2"."V2InboxEntry" i
              WHERE i."sessionId" = s."id" AND i."consumedSeq" IS NULL
                AND (i."kind" = 'stop' OR i."inboxId" > COALESCE((
                  SELECT (f."canonical"::jsonb ->> 'inboxHead')::int FROM "v2"."V2Event" f
                  WHERE f."threadId" = s."mainThreadId" AND f."type" = 'workspace-prepare-failed'
                    AND NOT EXISTS (SELECT 1 FROM "v2"."V2Event" p
                      WHERE p."threadId" = s."mainThreadId"
                        AND p."type" IN ('workspace-prepared', 'user-said'))
                  ORDER BY f."seq" DESC LIMIT 1), 0)))
            OR NOT EXISTS (SELECT 1 FROM "v2"."V2Event" e
              WHERE e."threadId" = s."mainThreadId"
                AND e."type" IN ('workspace-prepared', 'user-said', 'workspace-prepare-failed')))
        ORDER BY s."createdAt" ASC, s."id" ASC
        LIMIT ${params.limit}`
      .returnsRow({ id: 'pg/text@1' })
      .build(),
  )
  return rows.map((row) => row.id)
}
