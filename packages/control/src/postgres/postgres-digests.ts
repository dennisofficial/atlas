import type { Tx } from '@dltech/atlas-db'

import type { ControlSessionDigest, SessionListParams } from '../port'
import { iso } from './postgres-rows'

export const FIRST_MESSAGE_CHARS = 400

export const sessionDigestsIn = async (
  params: { tx: Tx } & SessionListParams,
): Promise<ControlSessionDigest[]> => {
  const anyProject = params.projectId === undefined
  const projectId = params.projectId ?? ''
  const rows = await params.tx.query(
    params.tx.raw
      .sql`SELECT s."id", s."userId", s."projectId", s."title", s."mainThreadId", s."createdAt",
        (SELECT e."at" FROM "v2"."V2Event" e
          WHERE e."threadId" = s."mainThreadId" ORDER BY e."seq" DESC LIMIT 1) AS "lastEventAt",
        (SELECT left(i."payload"::jsonb ->> 'text', ${FIRST_MESSAGE_CHARS}) FROM "v2"."V2InboxEntry" i
          WHERE i."sessionId" = s."id" AND i."kind" = 'message'
          ORDER BY i."inboxId" ASC LIMIT 1) AS "firstMessageText"
      FROM "v2"."V2Session" s
      WHERE s."userId" = ${params.userId}
        AND (${anyProject}::boolean OR s."projectId" = ${projectId})
      ORDER BY s."createdAt" DESC
      LIMIT ${params.limit}`
      .returnsRow({
        id: 'pg/text@1',
        userId: 'pg/text@1',
        projectId: 'pg/text@1',
        title: { codecId: 'pg/text@1', nullable: true },
        mainThreadId: 'pg/text@1',
        createdAt: 'pg/timestamptz-date@1',
        lastEventAt: { codecId: 'pg/timestamptz-date@1', nullable: true },
        firstMessageText: { codecId: 'pg/text@1', nullable: true },
      })
      .build(),
  )
  return rows.map((row) => ({
    sessionId: row.id,
    userId: row.userId,
    projectId: row.projectId,
    title: row.title,
    mainThreadId: row.mainThreadId,
    createdAt: iso(row.createdAt),
    lastEventAt: row.lastEventAt === null ? null : iso(row.lastEventAt),
    firstMessageText: row.firstMessageText,
  }))
}
