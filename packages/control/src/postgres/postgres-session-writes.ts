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
  modelRef?: string | undefined
  modelEffort?: string | undefined
  modelFast?: boolean | undefined
  spawnedBySessionId?: string | undefined
  nested?: boolean | undefined
  podSessionId?: string | undefined
  routineId?: string | undefined
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
    modelRef: params.modelRef ?? null,
    modelEffort: params.modelEffort ?? null,
    modelFast: params.modelFast ?? null,
    spawnedBySessionId: params.spawnedBySessionId ?? null,
    nested: params.nested ?? true,
    podSessionId: params.podSessionId ?? null,
    routineId: params.routineId ?? null,
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

export const setSessionArchivedIn = async (params: {
  tx: Tx
  sessionId: string
  archivedAt: string | null
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2Session.where({
    id: params.sessionId,
  }).updateAndCount({
    archivedAt: params.archivedAt === null ? null : new Date(params.archivedAt),
  })
  return changed === 1
}

export const setSessionTitleIfUntitledIn = async (params: {
  tx: Tx
  sessionId: string
  title: string
  fromInboxId: number | null
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2Session.where({
    id: params.sessionId,
    title: null,
  }).updateAndCount({
    title: params.title,
    titledFromInboxId: params.fromInboxId,
  })
  return changed === 1
}

export const setSessionTitleIn = async (params: {
  tx: Tx
  sessionId: string
  title: string
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2Session.where({
    id: params.sessionId,
  }).updateAndCount({ title: params.title, titledFromInboxId: null })
  return changed === 1
}

export const clearTitleFromIn = async (params: {
  tx: Tx
  sessionId: string
  inboxId: number
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2Session.where({
    id: params.sessionId,
    titledFromInboxId: params.inboxId,
  }).updateAndCount({ title: null, titledFromInboxId: null })
  return changed === 1
}
