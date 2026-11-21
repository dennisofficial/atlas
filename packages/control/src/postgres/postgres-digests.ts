import type { Tx } from '@dltech/atlas-db'

import type { SessionDigestRow, SessionListParams } from '../port'
import { iso } from './postgres-rows'

export const FIRST_MESSAGE_CHARS = 400

export const sessionDigestsIn = async (
  params: { tx: Tx } & SessionListParams,
): Promise<SessionDigestRow[]> => {
  const anyProject = params.projectId == null
  const projectId = params.projectId ?? ''
  const anySession = params.sessionId === undefined
  const sessionId = params.sessionId ?? ''
  const anySpawner = params.spawnedBySessionId === undefined
  const spawnedBySessionId = params.spawnedBySessionId ?? ''
  const rows = await params.tx.query(
    params.tx.raw
      .sql`SELECT s."id", s."userId", s."projectId", s."title", s."mainThreadId", s."createdAt", s."archivedAt",
        s."deletedAt", s."modelRef", s."modelEffort", s."modelFast", s."sandboxProvider",
        s."credentialSource", s."sandboxInstanceId", s."sandboxStatus", s."sandboxStatusAt",
        s."sandboxStatusReason",
        s."spawnedBySessionId", s."nested",
        s."podSessionId", s."podDesiredVcpus", s."podSizeGeneration", s."podActualVcpus",
        s."podAppliedGeneration", s."podResizeError", s."podWaitingSince", s."routineId", s."readSeq",
        (SELECT e."at" FROM "v2"."V2Event" e
          WHERE e."threadId" = s."mainThreadId" ORDER BY e."seq" DESC LIMIT 1) AS "lastEventAt",
        COALESCE((SELECT MAX(e."seq") FROM "v2"."V2Event" e
          WHERE e."threadId" = s."mainThreadId" AND e."type" = 'assistant-said'), 0) AS "lastAssistantSeq",
        first."text" AS "firstMessageText", first."postedAt" AS "firstMessageAt"
      FROM "v2"."V2Session" s
      LEFT JOIN LATERAL (
        SELECT left(i."payload"::jsonb ->> 'text', ${FIRST_MESSAGE_CHARS}) AS "text", i."postedAt"
          FROM "v2"."V2InboxEntry" i
          WHERE i."sessionId" = s."id" AND i."kind" = 'message'
          ORDER BY i."inboxId" ASC LIMIT 1
      ) first ON true
      WHERE s."userId" = ${params.userId}
        AND s."deletedAt" IS NULL
        AND (${anyProject}::boolean OR s."projectId" = ${projectId})
        AND (${anySession}::boolean OR s."id" = ${sessionId})
        AND (${anySpawner}::boolean OR s."spawnedBySessionId" = ${spawnedBySessionId})
      ORDER BY s."createdAt" DESC
      LIMIT ${params.limit}`
      .returnsRow({
        id: 'pg/text@1',
        userId: 'pg/text@1',
        projectId: { codecId: 'pg/text@1', nullable: true },
        title: { codecId: 'pg/text@1', nullable: true },
        mainThreadId: 'pg/text@1',
        createdAt: 'pg/timestamptz-date@1',
        archivedAt: { codecId: 'pg/timestamptz-date@1', nullable: true },
        deletedAt: { codecId: 'pg/timestamptz-date@1', nullable: true },
        modelRef: 'pg/text@1',
        modelEffort: 'pg/text@1',
        modelFast: 'pg/bool@1',
        sandboxProvider: 'pg/text@1',
        credentialSource: 'pg/text@1',
        sandboxInstanceId: { codecId: 'pg/text@1', nullable: true },
        sandboxStatus: { codecId: 'pg/text@1', nullable: true },
        sandboxStatusAt: { codecId: 'pg/timestamptz-date@1', nullable: true },
        sandboxStatusReason: { codecId: 'pg/text@1', nullable: true },
        spawnedBySessionId: { codecId: 'pg/text@1', nullable: true },
        nested: 'pg/bool@1',
        podSessionId: { codecId: 'pg/text@1', nullable: true },
        podDesiredVcpus: { codecId: 'pg/int4@1', nullable: true },
        podSizeGeneration: 'pg/int4@1',
        podActualVcpus: { codecId: 'pg/int4@1', nullable: true },
        podAppliedGeneration: { codecId: 'pg/int4@1', nullable: true },
        podResizeError: { codecId: 'pg/text@1', nullable: true },
        podWaitingSince: { codecId: 'pg/timestamptz-date@1', nullable: true },
        routineId: { codecId: 'pg/text@1', nullable: true },
        readSeq: { codecId: 'pg/int4@1', nullable: true },
        lastEventAt: { codecId: 'pg/timestamptz-date@1', nullable: true },
        lastAssistantSeq: 'pg/int4@1',
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
    deletedAt: row.deletedAt === null ? null : iso(row.deletedAt),
    modelRef: row.modelRef,
    modelEffort: row.modelEffort,
    modelFast: row.modelFast,
    sandboxProvider: row.sandboxProvider,
    credentialSource: row.credentialSource,
    sandboxInstanceId: row.sandboxInstanceId,
    sandboxStatus: row.sandboxStatus,
    sandboxStatusAt: row.sandboxStatusAt === null ? null : iso(row.sandboxStatusAt),
    sandboxStatusReason: row.sandboxStatusReason,
    spawnedBySessionId: row.spawnedBySessionId,
    nested: row.nested,
    podSessionId: row.podSessionId,
    podDesiredVcpus: row.podDesiredVcpus,
    podSizeGeneration: row.podSizeGeneration,
    podActualVcpus: row.podActualVcpus,
    podAppliedGeneration: row.podAppliedGeneration,
    podResizeError: row.podResizeError,
    podWaitingSince: row.podWaitingSince === null ? null : iso(row.podWaitingSince),
    routineId: row.routineId,
    readSeq: row.readSeq,
    lastEventAt: row.lastEventAt === null ? null : iso(row.lastEventAt),
    lastAssistantSeq: row.lastAssistantSeq,
    firstMessageText: row.firstMessageText,
    firstMessageAt: row.firstMessageAt === null ? null : iso(row.firstMessageAt),
  }))
}
