import type { Tx } from '@dltech/atlas-db'
import { PG_PRESENCE_LOCK_NAMESPACE } from '@dltech/atlas-protocol'

const needingHolderIn = (tx: Tx) =>
  tx.raw
    .sql`SELECT s."id" AS "id", s."createdAt" AS "createdAt", l."retryAfter" AS "retryAfter", l."epoch" AS "epoch"
        FROM "v2"."V2Session" s
        JOIN "v2"."V2Lease" l ON l."sessionId" = s."id"
        WHERE (l."holderHostId" IS NULL
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
                  'session-start-failed')))`.returnsRow({
    id: 'pg/text@1',
    epoch: 'pg/int4@1',
    createdAt: 'pg/timestamptz-date@1',
    retryAfter: { codecId: 'pg/timestamptz-date@1', nullable: true },
  })

export const claimableSessionIdsIn = async (params: {
  tx: Tx
  now: string
  limit: number
}): Promise<string[]> => {
  const rows = await params.tx.query(
    params.tx.raw.sql`SELECT n."id" FROM (${needingHolderIn(params.tx)}) n
        JOIN "v2"."V2Lease" l ON l."sessionId" = n."id" AND l."epoch" = n."epoch"
        WHERE n."retryAfter" IS NULL OR n."retryAfter" <= ${params.now}::timestamptz
        ORDER BY n."createdAt" ASC, n."id" ASC
        LIMIT ${params.limit}
        FOR UPDATE OF l SKIP LOCKED`
      .returnsRow({ id: 'pg/text@1' })
      .build(),
  )
  return rows.map((row) => row.id)
}

export const nextRetryAtIn = async (params: { tx: Tx; now: string }): Promise<string | null> => {
  const rows = await params.tx.query(
    params.tx.raw.sql`SELECT min(n."retryAfter") AS "at" FROM (${needingHolderIn(params.tx)}) n
        WHERE n."retryAfter" > ${params.now}::timestamptz`
      .returnsRow({ at: { codecId: 'pg/timestamptz-date@1', nullable: true } })
      .build(),
  )
  return rows[0]?.at?.toISOString() ?? null
}
