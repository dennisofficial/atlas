import type { Tx } from '@dltech/atlas-db'

import type { SessionDigestRow, SessionListParams } from '../port'
import { iso } from './postgres-rows'

export const FIRST_MESSAGE_CHARS = 400

export const sessionDigestsIn = async (
  params: { tx: Tx } & SessionListParams,
): Promise<SessionDigestRow[]> => {
  const anyProject = params.projectId === undefined
  const projectId = params.projectId ?? ''
  const anySession = params.sessionId === undefined
  const sessionId = params.sessionId ?? ''
  const rows = await params.tx.query(
    params.tx.raw
      .sql`SELECT s."id", s."userId", s."projectId", s."title", s."mainThreadId", s."createdAt", s."archivedAt",
        s."modelRef", s."modelEffort", s."modelFast",
        (SELECT e."at" FROM "v2"."V2Event" e
          WHERE e."threadId" = s."mainThreadId" ORDER BY e."seq" DESC LIMIT 1) AS "lastEventAt",
        first."text" AS "firstMessageText", first."postedAt" AS "firstMessageAt"
      FROM "v2"."V2Session" s
      LEFT JOIN LATERAL (
        SELECT left(i."payload"::jsonb ->> 'text', ${FIRST_MESSAGE_CHARS}) AS "text", i."postedAt"
          FROM "v2"."V2InboxEntry" i
          WHERE i."sessionId" = s."id" AND i."kind" = 'message'
          ORDER BY i."inboxId" ASC LIMIT 1
      ) first ON true
      WHERE s."userId" = ${params.userId}
        AND (${anyProject}::boolean OR s."projectId" = ${projectId})
        AND (${anySession}::boolean OR s."id" = ${sessionId})
      ORDER BY s."createdAt" DESC
      LIMIT ${params.limit}`
      .returnsRow({
        id: 'pg/text@1',
        userId: 'pg/text@1',
        projectId: 'pg/text@1',
        title: { codecId: 'pg/text@1', nullable: true },
        mainThreadId: 'pg/text@1',
        createdAt: 'pg/timestamptz-date@1',
        archivedAt: { codecId: 'pg/timestamptz-date@1', nullable: true },
        modelRef: { codecId: 'pg/text@1', nullable: true },
        modelEffort: { codecId: 'pg/text@1', nullable: true },
        modelFast: { codecId: 'pg/bool@1', nullable: true },
        lastEventAt: { codecId: 'pg/timestamptz-date@1', nullable: true },
        firstMessageText: { codecId: 'pg/text@1', nullable: true },
        firstMessageAt: { codecId: 'pg/timestamptz-date@1', nullable: true },
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
    archivedAt: row.archivedAt === null ? null : iso(row.archivedAt),
    modelRef: row.modelRef,
    modelEffort: row.modelEffort,
    modelFast: row.modelFast,
    lastEventAt: row.lastEventAt === null ? null : iso(row.lastEventAt),
    firstMessageText: row.firstMessageText,
    firstMessageAt: row.firstMessageAt === null ? null : iso(row.firstMessageAt),
  }))
}
