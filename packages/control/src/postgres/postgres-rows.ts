import type { Hash, InboxEntry, Lease } from '@dltech/atlas-core'

import type {
  ControlSessionRow,
  RoutineRow,
  RoutineRunOutcome,
  RoutineRunRow,
  StoredEvent,
  ThreadRow,
} from '../port'

export const iso = (value: Date): string => value.toISOString()

export const toLease = (row: {
  sessionId: string
  epoch: number
  holderHostId: number | null
  wantsHolder: boolean
  attempts: number
  retryAfter: Date | null
}): Lease => ({
  sessionId: row.sessionId,
  epoch: row.epoch,
  holderHostId: row.holderHostId,
  wantsHolder: row.wantsHolder,
  attempts: row.attempts,
  retryAfter: row.retryAfter === null ? null : iso(row.retryAfter),
})

export const toInbox = (row: {
  sessionId: string
  inboxId: number
  kind: string
  payload: string
  postedAt: Date
  consumedSeq: number | null
  senderSessionId: string | null
}): InboxEntry => ({ ...row, postedAt: iso(row.postedAt) })

export const toSessionRow = (row: {
  id: string
  userId: string
  projectId: string
  title: string | null
  mainThreadId: string
  createdAt: Date
  archivedAt: Date | null
  modelRef: string | null
  modelEffort: string | null
  modelFast: boolean | null
  modelAccountId: string | null
  spawnedBySessionId: string | null
  nested: boolean
  podSessionId: string | null
  routineId: string | null
}): ControlSessionRow => ({
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
  modelAccountId: row.modelAccountId,
  spawnedBySessionId: row.spawnedBySessionId,
  nested: row.nested,
  podSessionId: row.podSessionId,
  routineId: row.routineId,
})

export const toRoutineRow = (row: {
  id: string
  userId: string
  projectId: string
  name: string
  prompt: string
  cron: string
  timezone: string
  enabled: boolean
  modelRef: string | null
  modelEffort: string | null
  modelFast: boolean | null
  nextRunAt: Date
  lastRunAt: Date | null
  lastSessionId: string | null
  createdAt: Date
  updatedAt: Date
}): RoutineRow => ({
  routineId: row.id,
  userId: row.userId,
  projectId: row.projectId,
  name: row.name,
  prompt: row.prompt,
  cron: row.cron,
  timezone: row.timezone,
  enabled: row.enabled,
  modelRef: row.modelRef,
  modelEffort: row.modelEffort,
  modelFast: row.modelFast,
  nextRunAt: iso(row.nextRunAt),
  lastRunAt: row.lastRunAt === null ? null : iso(row.lastRunAt),
  lastSessionId: row.lastSessionId,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})

export const fromRoutineRow = (row: RoutineRow) => ({
  id: row.routineId,
  userId: row.userId,
  projectId: row.projectId,
  name: row.name,
  prompt: row.prompt,
  cron: row.cron,
  timezone: row.timezone,
  enabled: row.enabled,
  modelRef: row.modelRef,
  modelEffort: row.modelEffort,
  modelFast: row.modelFast,
  nextRunAt: new Date(row.nextRunAt),
  lastRunAt: row.lastRunAt === null ? null : new Date(row.lastRunAt),
  lastSessionId: row.lastSessionId,
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
})

export const toRoutineRunRow = (row: {
  id: string
  routineId: string
  scheduledFor: Date
  outcome: string
  reason: string | null
  sessionId: string | null
  at: Date
}): RoutineRunRow => ({
  id: row.id,
  routineId: row.routineId,
  scheduledFor: iso(row.scheduledFor),
  outcome: row.outcome as RoutineRunOutcome,
  reason: row.reason,
  sessionId: row.sessionId,
  at: iso(row.at),
})

export const toThreadRow = (row: {
  id: string
  sessionId: string
  headSeq: number
  headHash: string
  visibility: string
}): ThreadRow => ({
  threadId: row.id,
  sessionId: row.sessionId,
  headSeq: row.headSeq,
  headHash: row.headHash as Hash,
  visibility: row.visibility,
})

export const toStoredEvent = (row: {
  threadId: string
  seq: number
  id: string
  epoch: number
  type: string
  runId: string
  at: Date
  prevHash: string
  hash: string
  canonical: string
}): StoredEvent => ({
  threadId: row.threadId,
  seq: row.seq,
  id: row.id,
  epoch: row.epoch,
  type: row.type,
  runId: row.runId,
  at: iso(row.at),
  prevHash: row.prevHash as Hash,
  hash: row.hash as Hash,
  canonical: row.canonical,
})
