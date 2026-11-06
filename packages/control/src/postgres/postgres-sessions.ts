import type { Tx } from '@dltech/atlas-db'

import type { ControlSessionRow } from '../port'
import { toSessionRow } from './postgres-rows'

export const createSessionIn = async (params: {
  tx: Tx
  sessionId: string
  userId: string
  projectId: string
  title?: string | undefined
  mainThreadId: string
  at: string
}): Promise<void> => {
  await params.tx.orm.v2.V2Session.create({
    id: params.sessionId,
    userId: params.userId,
    projectId: params.projectId,
    title: params.title ?? null,
    titledFromInboxId: null,
    mainThreadId: params.mainThreadId,
    nextInboxId: 1,
    createdAt: new Date(params.at),
    archivedAt: null,
  })
  await params.tx.orm.v2.V2Lease.create({
    sessionId: params.sessionId,
    epoch: 0,
    holderHostId: null,
    wantsHolder: false,
    attempts: 0,
    retryAfter: null,
  })
}

export const readSessionIn = async (params: {
  tx: Tx
  sessionId: string
  lock: boolean
}): Promise<ControlSessionRow | undefined> => {
  const query = params.tx.orm.v2.V2Session.where({ id: params.sessionId })
  const row = await (params.lock ? query.forNoKeyUpdate() : query).first()
  return row === null ? undefined : toSessionRow(row)
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
