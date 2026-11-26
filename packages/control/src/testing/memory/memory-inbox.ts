import { EInputKind, type InboxEntry, type ThreadId } from '@dltech/atlas-core'

import { clientIdOfPayload } from '../../inbox-ops'
import type { State } from './memory-state'

export const allocateInboxIdIn = (params: { state: State; sessionId: string }): number => {
  const session = params.state.sessions.get(params.sessionId)
  if (session === undefined) throw new Error('unknown session')
  const id = session.nextInboxId
  session.nextInboxId += 1
  return id
}

export const insertInboxEntryIn = (params: { state: State; entry: InboxEntry }): void => {
  const list = params.state.inbox.get(params.entry.sessionId) ?? []
  list.push({ ...params.entry })
  params.state.inbox.set(params.entry.sessionId, list)
}

export const readInboxEntryIn = (params: {
  state: State
  sessionId: string
  inboxId: number
}): InboxEntry | undefined => {
  const found = params.state.inbox
    .get(params.sessionId)
    ?.find((entry) => entry.inboxId === params.inboxId)
  return found === undefined ? undefined : { ...found }
}

export const markInboxConsumedIn = (params: {
  state: State
  sessionId: string
  inboxId: number
  seq: number
}): boolean => {
  const found = params.state.inbox
    .get(params.sessionId)
    ?.find((entry) => entry.inboxId === params.inboxId)
  if (found === undefined || found.consumedSeq !== null) return false
  found.consumedSeq = params.seq
  return true
}

export const deleteInboxEntryIn = (params: {
  state: State
  sessionId: string
  inboxId: number
}): boolean => {
  const list = params.state.inbox.get(params.sessionId) ?? []
  const index = list.findIndex((entry) => entry.inboxId === params.inboxId)
  if (index < 0) return false
  list.splice(index, 1)
  return true
}

export const readInboxEntriesIn = (params: {
  state: State
  sessionId: string
  afterId: number
  limit: number
  excludeKind?: string | undefined
  forThread: ThreadId | null
}): InboxEntry[] =>
  (params.state.inbox.get(params.sessionId) ?? [])
    .filter((entry) => entry.inboxId > params.afterId && entry.consumedSeq === null)
    .filter((entry) => entry.kind !== params.excludeKind)
    .filter((entry) => entry.threadId === params.forThread)
    .sort((a, b) => a.inboxId - b.inboxId)
    .slice(0, params.limit)
    .map((entry) => ({ ...entry }))

export const firstUnconsumedMessagesIn = (params: {
  state: State
  sessionIds: readonly string[]
}): InboxEntry[] =>
  params.sessionIds.flatMap((sessionId) => {
    const first = (params.state.inbox.get(sessionId) ?? [])
      .filter((entry) => entry.consumedSeq === null)
      .filter((entry) => entry.kind === EInputKind.Message && entry.threadId === null)
      .sort((left, right) => left.inboxId - right.inboxId)[0]
    return first === undefined ? [] : [{ ...first }]
  })

export const inboxEntryWithClientIdIn = (params: {
  state: State
  sessionId: string
  clientId: string
  forThread: ThreadId | null
}): InboxEntry | undefined => {
  const found = (params.state.inbox.get(params.sessionId) ?? [])
    .filter((entry) => entry.threadId === params.forThread)
    .sort((left, right) => left.inboxId - right.inboxId)
    .find((entry) => clientIdOfPayload(entry.payload) === params.clientId)
  return found === undefined ? undefined : { ...found }
}

export const recentInboxEntriesIn = (params: {
  state: State
  sessionId: string
  limit: number
  forThread: ThreadId | null
}): InboxEntry[] =>
  (params.state.inbox.get(params.sessionId) ?? [])
    .filter((entry) => entry.threadId === params.forThread)
    .slice()
    .sort((a, b) => b.inboxId - a.inboxId)
    .slice(0, params.limit)
    .map((entry) => ({ ...entry }))
