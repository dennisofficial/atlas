import { isUniqueViolation, type Tx } from '@dltech/atlas-db'
import { PG_CHANGE_CHANNEL } from '@dltech/atlas-protocol'

import {
  SeqConflictError,
  type AppendCommit,
  type AppendOpening,
  type SessionViewRow,
} from '../port'
import { toLease, toThreadRow } from './postgres-rows'

const openingRow = {
  id: 'pg/text@1',
  sessionId: 'pg/text@1',
  headSeq: 'pg/int4@1',
  headHash: 'pg/text@1',
  visibility: 'pg/text@1',
  mainThreadId: 'pg/text@1',
  leaseSessionId: { codecId: 'pg/text@1', nullable: true },
  epoch: { codecId: 'pg/int4@1', nullable: true },
  holderHostId: { codecId: 'pg/int4@1', nullable: true },
  wantsHolder: { codecId: 'pg/bool@1', nullable: true },
  attempts: { codecId: 'pg/int4@1', nullable: true },
  retryAfter: { codecId: 'pg/timestamptz-date@1', nullable: true },
  viewSessionId: { codecId: 'pg/text@1', nullable: true },
  viewThreadId: { codecId: 'pg/text@1', nullable: true },
  atSeq: { codecId: 'pg/int4@1', nullable: true },
  version: { codecId: 'pg/int4@1', nullable: true },
  state: { codecId: 'pg/text@1', nullable: true },
} as const

const openingViewOf = (row: {
  viewSessionId: string | null
  viewThreadId: string | null
  atSeq: number | null
  version: number | null
  state: string | null
}): SessionViewRow | undefined => {
  if (row.viewSessionId === null || row.viewThreadId === null) return undefined
  if (row.atSeq === null || row.version === null || row.state === null) return undefined
  return {
    sessionId: row.viewSessionId,
    threadId: row.viewThreadId,
    atSeq: row.atSeq,
    version: row.version,
    state: row.state,
  }
}

export const openAppendIn = async (params: {
  tx: Tx
  threadId: string
}): Promise<AppendOpening | undefined> => {
  const { tx } = params
  const rows = await tx.query(
    tx.raw.sql`WITH t AS (
        SELECT "id", "sessionId", "headSeq", "headHash", "visibility"
          FROM "public"."Thread" WHERE "id" = ${params.threadId} FOR NO KEY UPDATE
      ), l AS (
        SELECT l.* FROM "public"."Lease" l JOIN t ON l."sessionId" = t."sessionId" FOR SHARE OF l
      )
      SELECT t."id" AS "id", t."sessionId" AS "sessionId", t."headSeq" AS "headSeq",
        t."headHash" AS "headHash", t."visibility" AS "visibility",
        s."mainThreadId" AS "mainThreadId",
        l."sessionId" AS "leaseSessionId", l."epoch" AS "epoch",
        l."holderHostId" AS "holderHostId", l."wantsHolder" AS "wantsHolder",
        l."attempts" AS "attempts", l."retryAfter" AS "retryAfter",
        v."sessionId" AS "viewSessionId", v."threadId" AS "viewThreadId",
        v."atSeq" AS "atSeq", v."version" AS "version", v."state" AS "state"
        FROM t
        JOIN "public"."Session" s ON s."id" = t."sessionId"
        LEFT JOIN l ON true
        LEFT JOIN "public"."SessionView" v ON v."sessionId" = t."sessionId"`
      .returnsRow(openingRow)
      .build(),
  )
  const [row] = rows
  if (row === undefined) return undefined
  return {
    row: toThreadRow(row),
    lease:
      row.leaseSessionId === null
        ? undefined
        : toLease({
            sessionId: row.leaseSessionId,
            epoch: row.epoch ?? 0,
            holderHostId: row.holderHostId,
            wantsHolder: row.wantsHolder ?? false,
            attempts: row.attempts ?? 0,
            retryAfter: row.retryAfter,
          }),
    mainThreadId: row.mainThreadId,
    view: openingViewOf(row),
  }
}

const NO_VIEW = { threadId: '', atSeq: 0, version: 0, state: '' }

export const commitAppendIn = async (params: { tx: Tx } & AppendCommit): Promise<boolean> => {
  const { tx, head } = params
  const view = params.view ?? NO_VIEW
  try {
    const rows = await tx.query(
      tx.raw.sql`WITH inserted AS (
          INSERT INTO "public"."Event" ("threadId", "seq", "id", "epoch", "type", "runId", "at",
            "prevHash", "hash", "canonical")
          SELECT e."threadId", e."seq", e."id", e."epoch", e."type", e."runId", e."at",
            e."prevHash", e."hash", e."canonical"
            FROM jsonb_to_recordset(${JSON.stringify(params.events)}::jsonb) AS e(
              "threadId" text, "seq" int4, "id" text, "epoch" int4, "type" text, "runId" text,
              "at" timestamptz, "prevHash" text, "hash" text, "canonical" text)
        ), head AS (
          UPDATE "public"."Thread"
            SET "headSeq" = ${head.headSeq}, "headHash" = ${head.headHash},
              "visibility" = ${head.visibility}
            WHERE "id" = ${head.threadId} AND "headSeq" = ${head.expectedHeadSeq}
            RETURNING "id", "sessionId"
        ), view AS (
          INSERT INTO "public"."SessionView" ("sessionId", "threadId", "atSeq", "version", "state",
            "updatedAt")
          SELECT h."sessionId", ${view.threadId}, ${view.atSeq}, ${view.version}, ${view.state},
            clock_timestamp()
            FROM head h
            WHERE ${params.view !== undefined}::boolean
            ON CONFLICT ("sessionId") DO UPDATE
              SET "threadId" = EXCLUDED."threadId", "atSeq" = EXCLUDED."atSeq",
                "version" = EXCLUDED."version", "state" = EXCLUDED."state",
                "updatedAt" = EXCLUDED."updatedAt"
        ), notified AS (
          SELECT h."id" AS "id", (pg_notify(${PG_CHANGE_CHANNEL}, ${JSON.stringify(
            params.change,
          )}) IS NULL)::text AS "sent"
            FROM head h
        )
        SELECT "id" FROM notified`
        .returnsRow({ id: 'pg/text@1' })
        .build(),
    )
    return rows.length === 1
  } catch (error) {
    if (isUniqueViolation(error)) throw new SeqConflictError()
    throw error
  }
}
