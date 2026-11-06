import type { Hash, InboxEntry, Lease } from '@dltech/atlas-core'

import type { ControlSessionRow, StoredEvent, ThreadRow } from '../port'

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
}): InboxEntry => ({ ...row, postedAt: iso(row.postedAt) })

export const toSessionRow = (row: {
  id: string
  userId: string
  projectId: string
  title: string | null
  mainThreadId: string
  createdAt: Date
  archivedAt: Date | null
}): ControlSessionRow => ({
  sessionId: row.id,
  userId: row.userId,
  projectId: row.projectId,
  title: row.title,
  mainThreadId: row.mainThreadId,
  createdAt: iso(row.createdAt),
  archivedAt: row.archivedAt === null ? null : iso(row.archivedAt),
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
