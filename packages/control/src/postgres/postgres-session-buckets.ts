import type { Tx } from '@dltech/atlas-db'

import type { SessionBucketCountParams, SessionBucketCounts } from '../port'
import { likePatternOf } from './postgres-digests'

export const sessionBucketCountsIn = async (
  params: { tx: Tx } & SessionBucketCountParams,
): Promise<SessionBucketCounts> => {
  const anySearch = params.search === undefined || params.search.length === 0
  const search = likePatternOf(params.search ?? '')
  const rows = await params.tx.query(
    params.tx.raw.sql`SELECT
        (COUNT(*) FILTER (WHERE s."archivedAt" IS NOT NULL))::int AS "archived"
      FROM "public"."Session" s
      LEFT JOIN LATERAL (
        SELECT left(i."payload"::jsonb ->> 'text', 400) AS "text"
          FROM "public"."InboxEntry" i
          WHERE i."sessionId" = s."id" AND i."kind" = 'message'
          ORDER BY i."inboxId" ASC LIMIT 1
      ) first ON true
      WHERE s."userId" = ${params.userId}
        AND s."deletedAt" IS NULL
        AND (${anySearch}::boolean OR s."title" ILIKE ${search} OR first."text" ILIKE ${search})`
      .returnsRow({ archived: 'pg/int4@1' })
      .build(),
  )
  const row = rows[0]
  if (row === undefined) return { archived: 0 }
  return { archived: row.archived }
}
