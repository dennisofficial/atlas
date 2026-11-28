import { and, isUniqueViolation, type Tx } from '@dltech/atlas-db'
import type { Hash } from '@dltech/atlas-core'

import {
  SeqConflictError,
  type ControlSessionRow,
  type ReadEventsParams,
  type StoredEvent,
} from '../port'
import { toSessionRow, toStoredEvent } from './postgres-rows'

export const writeThreadHeadIn = async (params: {
  tx: Tx
  threadId: string
  expectedHeadSeq: number
  headSeq: number
  headHash: Hash
  visibility: string
}): Promise<boolean> => {
  const changed = await params.tx.orm.public.Thread.where({
    id: params.threadId,
    headSeq: params.expectedHeadSeq,
  }).updateAndCount({
    headSeq: params.headSeq,
    headHash: params.headHash,
    visibility: params.visibility,
  })
  return changed === 1
}

export const insertEventsIn = async (params: {
  tx: Tx
  rows: readonly StoredEvent[]
}): Promise<void> => {
  try {
    await params.tx.orm.public.Event.createAndCount(
      params.rows.map((row) => ({ ...row, at: new Date(row.at) })),
    )
  } catch (error) {
    if (isUniqueViolation(error)) throw new SeqConflictError()
    throw error
  }
}

export const readEventsIn = async (
  params: { tx: Tx } & ReadEventsParams,
): Promise<StoredEvent[]> => {
  const { onlyTypes } = params
  let query = params.tx.orm.public.Event.where((e) =>
    and(e.threadId.eq(params.threadId), e.seq.gt(params.afterSeq), e.seq.lte(params.throughSeq)),
  )
  if (onlyTypes !== undefined) query = query.where((e) => e.type.in([...onlyTypes]))
  const rows = await query
    .orderBy((e) => e.seq.asc())
    .limit(params.limit)
    .all()
  return rows.map(toStoredEvent)
}

export const readEventCursorIn = async (params: { tx: Tx; threadId: string; seq: number }) => {
  const row = await params.tx.orm.public.Event.where({ threadId: params.threadId, seq: params.seq })
    .select('seq', 'hash')
    .first()
  return row === null ? undefined : { seq: row.seq, hash: row.hash as Hash }
}

export const readEventsByBytesIn = async (
  params: { tx: Tx; maxBytes: number } & ReadEventsParams,
) => {
  const rows = await params.tx.query(
    params.tx.raw.sql`WITH candidates AS (
      SELECT * FROM "public"."Event"
      WHERE "threadId" = ${params.threadId}
        AND "seq" > ${params.afterSeq} AND "seq" <= ${params.throughSeq}
        AND (${params.onlyTypes === undefined}::boolean
          OR "type" IN (SELECT jsonb_array_elements_text(${JSON.stringify(params.onlyTypes ?? [])}::jsonb)))
      ORDER BY "seq" LIMIT ${params.limit}
    ), measured AS (
      SELECT *, row_number() OVER (ORDER BY "seq") AS ordinal,
        sum(octet_length("canonical")) OVER (ORDER BY "seq") AS bytes,
        count(*) OVER () AS total
      FROM candidates
    )
    SELECT "threadId", "seq", "id", "epoch", "type", "runId", "at", "prevHash", "hash", "canonical",
      total > count(*) OVER () AS "stoppedEarly"
    FROM measured WHERE ordinal = 1 OR bytes <= ${params.maxBytes}
    ORDER BY "seq"`
      .returnsRow({
        threadId: 'pg/text@1',
        seq: 'pg/int4@1',
        id: 'pg/text@1',
        epoch: 'pg/int4@1',
        type: 'pg/text@1',
        runId: 'pg/text@1',
        at: 'pg/timestamptz-date@1',
        prevHash: 'pg/text@1',
        hash: 'pg/text@1',
        canonical: 'pg/text@1',
        stoppedEarly: 'pg/bool@1',
      })
      .build(),
  )
  return { rows: rows.map(toStoredEvent), stoppedEarly: rows[0]?.stoppedEarly ?? false }
}

export const listSessionsIn = async (params: {
  tx: Tx
  userId: string
  projectId?: string | undefined
  limit: number
}): Promise<ControlSessionRow[]> => {
  const where =
    params.projectId === undefined
      ? { userId: params.userId }
      : { userId: params.userId, projectId: params.projectId }
  const rows = await params.tx.orm.public.Session.where(where)
    .where((session) => session.deletedAt.isNull())
    .orderBy((s) => s.createdAt.desc())
    .limit(params.limit)
    .all()
  return rows.map((row) => toSessionRow(row))
}
