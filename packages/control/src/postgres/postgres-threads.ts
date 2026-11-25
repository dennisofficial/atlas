import { and, isUniqueViolation, type Tx } from '@dltech/atlas-db'
import { PICTURE_BLOCK_PATTERN, PICTURE_BYTES_PATTERN, type Hash } from '@dltech/atlas-core'

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

const WITHHELD_BYTES_TEXT = '"bytes":{"kind":"withheld"}'

const WITHHELD_BLOCK_TEXT = '{\\1,"type":"image","withheld":true}'

const typeFilterOf = (onlyTypes: readonly string[] | undefined): string =>
  onlyTypes === undefined ? '' : `,${onlyTypes.join(',')},`

const readWithheldEventsIn = async (
  params: { tx: Tx } & ReadEventsParams,
): Promise<StoredEvent[]> => {
  const { tx } = params
  const typeFilter = typeFilterOf(params.onlyTypes)
  const rows = await tx.query(
    tx.raw.sql`SELECT
        "threadId", "seq", "id", "epoch", "type", "runId", "at", "prevHash", "hash",
        CASE WHEN "type" = 'tool-result' THEN regexp_replace(
          regexp_replace("canonical", ${PICTURE_BYTES_PATTERN}, ${WITHHELD_BYTES_TEXT}, 'g'),
          ${PICTURE_BLOCK_PATTERN}, ${WITHHELD_BLOCK_TEXT}, 'g'
        ) ELSE "canonical" END AS "canonical"
      FROM "public"."Event"
      WHERE "threadId" = ${params.threadId}
        AND "seq" > ${params.afterSeq}
        AND "seq" <= ${params.throughSeq}
        AND (${typeFilter} = '' OR position((',' || "type" || ',') in ${typeFilter}) > 0)
      ORDER BY "seq" ASC
      LIMIT ${params.limit}`
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
      })
      .build(),
  )
  return rows.map(toStoredEvent)
}

export const readEventsIn = async (
  params: { tx: Tx } & ReadEventsParams,
): Promise<StoredEvent[]> => {
  if (params.withholdPictures === true) return readWithheldEventsIn(params)
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
