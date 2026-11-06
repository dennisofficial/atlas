import type { Hash, InboxEntry } from '@dltech/atlas-core'

import type { ControlSessionRow, StoredEvent, ThreadRow } from '../port'

export const iso = (value: Date): string => value.toISOString()

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
}): ControlSessionRow => ({
  sessionId: row.id,
  userId: row.userId,
  projectId: row.projectId,
  title: row.title,
  mainThreadId: row.mainThreadId,
  createdAt: iso(row.createdAt),
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
