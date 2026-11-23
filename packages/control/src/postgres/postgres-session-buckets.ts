import type { Tx } from '@dltech/atlas-db'

import type { SessionBucketCountParams, SessionBucketCounts } from '../port'
import { likePatternOf } from './postgres-digests'

const EPOCH_ISO = '1970-01-01T00:00:00.000Z'

export const sessionBucketCountsIn = async (
  params: { tx: Tx } & SessionBucketCountParams,
): Promise<SessionBucketCounts> => {
  const anySearch = params.search === undefined || params.search.length === 0
  const search = likePatternOf(params.search ?? '')
  const idleBefore = params.idleBefore.length === 0 ? EPOCH_ISO : params.idleBefore
  const rows = await params.tx.query(
    params.tx.raw.sql`SELECT
        (COUNT(*) FILTER (WHERE s."archivedAt" IS NOT NULL))::int AS "archived",
        (COUNT(*) FILTER (WHERE s."archivedAt" IS NULL
          AND COALESCE((SELECT e."at" FROM "v2"."V2Event" e
            WHERE e."threadId" = s."mainThreadId" ORDER BY e."seq" DESC LIMIT 1),
            s."createdAt") < ${idleBefore}::timestamptz))::int AS "inactive"
      FROM "v2"."V2Session" s
      LEFT JOIN LATERAL (
        SELECT left(i."payload"::jsonb ->> 'text', 400) AS "text"
          FROM "v2"."V2InboxEntry" i
          WHERE i."sessionId" = s."id" AND i."kind" = 'message'
          ORDER BY i."inboxId" ASC LIMIT 1
      ) first ON true
      WHERE s."userId" = ${params.userId}
        AND s."deletedAt" IS NULL
        AND (${anySearch}::boolean OR s."title" ILIKE ${search} OR first."text" ILIKE ${search})`
      .returnsRow({ archived: 'pg/int4@1', inactive: 'pg/int4@1' })
      .build(),
  )
  const row = rows[0]
  if (row === undefined) return { inactive: 0, archived: 0 }
  return { archived: row.archived, inactive: row.inactive }
}
