import type { Tx } from '@dltech/atlas-db'
import { PG_PRESENCE_LOCK_NAMESPACE } from '@dltech/atlas-protocol'

export const sessionsNeedingHolderIn = async (params: {
  tx: Tx
  limit: number
}): Promise<string[]> => {
  const rows = await params.tx.query(
    params.tx.raw.sql`SELECT s."id" FROM "v2"."V2Session" s
        LEFT JOIN "v2"."V2Lease" l ON l."sessionId" = s."id"
        WHERE (l."sessionId" IS NULL OR l."holderHostId" IS NULL
            OR NOT EXISTS (SELECT 1 FROM pg_locks k
              WHERE k.locktype = 'advisory' AND k.granted AND k.mode = 'ExclusiveLock'
                AND k.database = (SELECT oid FROM pg_database WHERE datname = current_database())
                AND k.classid = ${PG_PRESENCE_LOCK_NAMESPACE}::oid
                AND k.objid = l."holderHostId"::oid AND k.objsubid = 2))
          AND (l."holderHostId" IS NOT NULL OR l."wantsHolder"
            OR EXISTS (SELECT 1 FROM "v2"."V2InboxEntry" i
              WHERE i."sessionId" = s."id" AND i."consumedSeq" IS NULL
                AND (i."kind" = 'stop' OR i."inboxId" > GREATEST(COALESCE((
                  SELECT (f."canonical"::jsonb ->> 'inboxHead')::int FROM "v2"."V2Event" f
                  WHERE f."threadId" = s."mainThreadId" AND f."type" = 'workspace-prepare-failed'
                    AND NOT EXISTS (SELECT 1 FROM "v2"."V2Event" p
                      WHERE p."threadId" = s."mainThreadId"
                        AND p."type" IN ('workspace-prepared', 'user-said'))
                  ORDER BY f."seq" DESC LIMIT 1), 0), COALESCE((
                  SELECT (g."canonical"::jsonb ->> 'inboxHead')::int FROM "v2"."V2Event" g
                  WHERE g."threadId" = s."mainThreadId" AND g."type" = 'session-start-failed'
                    AND NOT EXISTS (SELECT 1 FROM "v2"."V2Event" q
                      WHERE q."threadId" = s."mainThreadId" AND q."seq" > g."seq"
                        AND q."type" IN ('user-said', 'assistant-said', 'workspace-prepared',
                          'workspace-prepare-failed', 'run-failed'))
                  ORDER BY g."seq" DESC LIMIT 1), 0))))
            OR NOT EXISTS (SELECT 1 FROM "v2"."V2Event" e
              WHERE e."threadId" = s."mainThreadId"
                AND e."type" IN ('workspace-prepared', 'user-said', 'workspace-prepare-failed',
                  'session-start-failed')))
        ORDER BY s."createdAt" ASC, s."id" ASC
        LIMIT ${params.limit}`
      .returnsRow({ id: 'pg/text@1' })
      .build(),
  )
  return rows.map((row) => row.id)
}
