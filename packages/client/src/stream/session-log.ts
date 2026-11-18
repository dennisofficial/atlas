import type { PendingInputsState, V2Event, VisibilityState } from '@dltech/atlas-core'

import type { SessionCursor } from './session-window'

export const SESSION_LOG_STRUCTURE_VERSION = 2

export type SessionLogSnapshot = {
  version: number
  cursor: SessionCursor | undefined
  visibility: VisibilityState
  pending: PendingInputsState
  throughSeq: number
}

export type SessionLog = {
  appendPage(args: {
    sessionId: string
    events: readonly V2Event[]
    head: SessionCursor
  }): Promise<void>
  readRange(args: {
    sessionId: string
    fromSeq: number
    toSeq: number
  }): Promise<readonly V2Event[]>
  readTail(args: { sessionId: string; count: number }): Promise<readonly V2Event[]>
  readBefore(args: { sessionId: string; seq: number; count: number }): Promise<readonly V2Event[]>
  loadSnapshot(sessionId: string): Promise<SessionLogSnapshot | undefined>
  saveSnapshot(args: { sessionId: string; snapshot: SessionLogSnapshot }): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  listSessions(): Promise<readonly string[]>
  clear(): Promise<void>
}

type Held = { events: Map<number, V2Event>; snapshot: SessionLogSnapshot | undefined }

export const memorySessionLog = (): SessionLog & { saveCount: () => number } => {
  const held = new Map<string, Held>()
  let saves = 0
  const of = (sessionId: string): Held => {
    const existing = held.get(sessionId)
    if (existing !== undefined) return existing
    const created: Held = { events: new Map(), snapshot: undefined }
    held.set(sessionId, created)
    return created
  }
  const seqs = (sessionId: string): number[] =>
    [...of(sessionId).events.keys()].sort((a, b) => a - b)
  const pick = (sessionId: string, seqsAt: readonly number[]): readonly V2Event[] =>
    seqsAt.flatMap((seq) => {
      const event = held.get(sessionId)?.events.get(seq)
      return event === undefined ? [] : [event]
    })

  return {
    appendPage: ({ sessionId, events }) => {
      const store = of(sessionId)
      for (const event of events) store.events.set(event.seq, event)
      return Promise.resolve()
    },
    readRange: ({ sessionId, fromSeq, toSeq }) =>
      Promise.resolve(
        pick(
          sessionId,
          seqs(sessionId).filter((seq) => seq >= fromSeq && seq <= toSeq),
        ),
      ),
    readTail: ({ sessionId, count }) =>
      Promise.resolve(pick(sessionId, seqs(sessionId).slice(-count))),
    readBefore: ({ sessionId, seq, count }) =>
      Promise.resolve(
        pick(
          sessionId,
          seqs(sessionId)
            .filter((at) => at < seq)
            .slice(-count),
        ),
      ),
    loadSnapshot: (sessionId) => Promise.resolve(held.get(sessionId)?.snapshot),
    saveSnapshot: ({ sessionId, snapshot }) => {
      saves += 1
      of(sessionId).snapshot = snapshot
      return Promise.resolve()
    },
    deleteSession: (sessionId) => {
      held.delete(sessionId)
      return Promise.resolve()
    },
    listSessions: () => Promise.resolve([...held.keys()]),
    clear: () => {
      held.clear()
      return Promise.resolve()
    },
    saveCount: () => saves,
  }
}
