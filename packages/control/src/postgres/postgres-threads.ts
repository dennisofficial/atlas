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
  const changed = await params.tx.orm.v2.V2Thread.where({
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
    await params.tx.orm.v2.V2Event.createAndCount(
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
  let query = params.tx.orm.v2.V2Event.where((e) =>
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
  const rows = await params.tx.orm.v2.V2Session.where(where)
    .orderBy((s) => s.createdAt.desc())
    .limit(params.limit)
    .all()
  return rows.map((row) => toSessionRow(row))
}
