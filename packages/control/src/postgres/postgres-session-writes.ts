import type { Tx } from '@dltech/atlas-db'

import type { ControlSessionRow } from '../port'
import { announceIn } from './postgres-notify'
import { lockPodRetireOfSessionIn } from './postgres-pod-retire-lock'
import { toSessionRow } from './postgres-rows'

export const createSessionIn = async (params: {
  tx: Tx
  sessionId: string
  userId: string
  projectId: string | null
  title?: string | undefined
  mainThreadId: string
  modelRef: string
  modelEffort: string
  modelFast: boolean
  sandboxProvider: string
  credentialSource: string
  sandboxInstanceId: string | null
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
    deletedAt: null,
    modelRef: params.modelRef,
    modelEffort: params.modelEffort,
    modelFast: params.modelFast,
    sandboxProvider: params.sandboxProvider,
    credentialSource: params.credentialSource,
    sandboxInstanceId: params.sandboxInstanceId,
    sandboxStatus: null,
    sandboxStatusAt: null,
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

export const readNestedChildrenIn = async (params: {
  tx: Tx
  sessionId: string
}): Promise<ControlSessionRow[]> => {
  const rows = await params.tx.orm.v2.V2Session.where({
    spawnedBySessionId: params.sessionId,
    nested: true,
  }).all()
  return rows.map(toSessionRow)
}

export const softDeleteArchivedSessionsIn = async (params: {
  tx: Tx
  cutoff: Date
  at: Date
}): Promise<number> => {
  const rows = await params.tx.query(
    params.tx.raw.sql`UPDATE "v2"."V2Session" s
        SET "deletedAt" = ${params.at.toISOString()}::timestamptz
        WHERE s."archivedAt" < ${params.cutoff.toISOString()}::timestamptz
          AND s."deletedAt" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "v2"."V2Session" peer
            WHERE COALESCE(peer."podSessionId", peer."id") = COALESCE(s."podSessionId", s."id")
              AND peer."archivedAt" IS NULL
          )
        RETURNING s."id"`
      .returnsRow({ id: 'pg/text@1' })
      .build(),
  )
  return rows.length
}

export const setSessionModelIn = async (params: {
  tx: Tx
  sessionId: string
  modelRef: string
  modelEffort: string
  modelFast: boolean
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2Session.where({
    id: params.sessionId,
  }).updateAndCount({
    modelRef: params.modelRef,
    modelEffort: params.modelEffort,
    modelFast: params.modelFast,
  })
  return changed === 1
}

export const setSandboxInstanceIdIn = async (params: {
  tx: Tx
  sessionId: string
  sandboxInstanceId: string | null
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2Session.where({
    id: params.sessionId,
  }).updateAndCount({ sandboxInstanceId: params.sandboxInstanceId })
  return changed === 1
}

export const setSandboxStatusIn = async (params: {
  tx: Tx
  sandboxInstanceId: string
  status: string
  reason?: string | undefined
  at: string
}): Promise<boolean> => {
  const rows = await params.tx.query(
    params.tx.raw.sql`UPDATE "v2"."V2Session"
      SET "sandboxStatus" = ${params.status},
        "sandboxStatusReason" = NULLIF(${params.reason ?? ''}, ''),
        "sandboxStatusAt" = ${params.at}::timestamptz
      WHERE "sandboxInstanceId" = ${params.sandboxInstanceId}
        AND ("sandboxStatusAt" IS NULL OR "sandboxStatusAt" < ${params.at}::timestamptz)
      RETURNING "id"`
      .returnsRow({ id: 'pg/text@1' })
      .build(),
  )
  const sessionId = rows[0]?.id
  if (sessionId === undefined) return false
  await announceIn({ tx: params.tx, change: { sessionId } })
  return true
}

export const setSessionPodWaitCancelledIn = async (params: {
  tx: Tx
  sessionId: string
  generation: number
  vcpus: number | null
  memoryGb: number | null
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2Session.where({
    id: params.sessionId,
  }).updateAndCount({
    podDesiredVcpus: params.vcpus,
    podDesiredMemoryGb: params.memoryGb,
    podDesiredDiskGb: null,
    podSizeGeneration: params.generation,
    podAppliedGeneration: params.generation,
    podResizeError: null,
    podWaitingSince: null,
  })
  return changed === 1
}

export const setSessionArchivedIn = async (params: {
  tx: Tx
  sessionId: string
  archivedAt: string | null
}): Promise<boolean> => {
  if (params.archivedAt === null) {
    await lockPodRetireOfSessionIn({ tx: params.tx, sessionId: params.sessionId })
  }
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

export const setSessionReadSeqIn = async (params: {
  tx: Tx
  sessionId: string
  seq: number
}): Promise<number | undefined> => {
  const [row] = await params.tx.query(
    params.tx.raw.sql`UPDATE "v2"."V2Session"
        SET "readSeq" = GREATEST(COALESCE("readSeq", -1), ${params.seq})
        WHERE "id" = ${params.sessionId} AND "deletedAt" IS NULL
        RETURNING "readSeq"`
      .returnsRow({ readSeq: 'pg/int4@1' })
      .build(),
  )
  return row?.readSeq
}

export const setSessionPodDesiredIn = async (params: {
  tx: Tx
  sessionId: string
  vcpus: number
  memoryGb: number
  diskGb?: number | undefined
  generation: number
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2Session.where({
    id: params.sessionId,
  }).updateAndCount({
    podDesiredVcpus: params.vcpus,
    podDesiredMemoryGb: params.memoryGb,
    ...(params.diskGb === undefined ? {} : { podDesiredDiskGb: params.diskGb }),
    podSizeGeneration: params.generation,
    podResizeError: null,
    podWaitingSince: null,
  })
  return changed === 1
}

export const setSessionPodAppliedIn = async (params: {
  tx: Tx
  sessionId: string
  vcpus: number
  memoryGb: number
  generation: number
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2Session.where({
    id: params.sessionId,
    podSizeGeneration: params.generation,
  }).updateAndCount({
    podActualVcpus: params.vcpus,
    podActualMemoryGb: params.memoryGb,
    podAppliedGeneration: params.generation,
    podResizeError: null,
    podWaitingSince: null,
  })
  return changed === 1
}

export const setSessionPodDiskIn = async (params: {
  tx: Tx
  sessionId: string
  diskGb: number
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2Session.where({
    id: params.sessionId,
  }).updateAndCount({ podDesiredDiskGb: params.diskGb })
  return changed === 1
}

export const setSessionPodFailedIn = async (params: {
  tx: Tx
  sessionId: string
  generation: number
  error: string
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2Session.where({
    id: params.sessionId,
    podSizeGeneration: params.generation,
  }).updateAndCount({ podResizeError: params.error, podWaitingSince: null })
  return changed === 1
}

export const setSessionPodWaitingIn = async (params: {
  tx: Tx
  sessionId: string
  generation: number
  since: string | null
}): Promise<boolean> => {
  const changed = await params.tx.orm.v2.V2Session.where({
    id: params.sessionId,
    podSizeGeneration: params.generation,
  }).updateAndCount({
    podWaitingSince: params.since === null ? null : new Date(params.since),
  })
  return changed === 1
}
