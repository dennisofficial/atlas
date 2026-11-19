import type { StreamServerMessage, StreamSessionRow } from '@dltech/atlas-protocol'

export type FollowedSessionList = {
  getSnapshot(): readonly StreamSessionRow[] | undefined
  subscribe(listener: () => void): () => void
  close(): void
}

export type SessionsListMessage = Extract<
  StreamServerMessage,
  { type: 'snapshot' | 'upsert' | 'remove' }
>

export type SessionsList = {
  handleMessage(message: SessionsListMessage): void
  view: Omit<FollowedSessionList, 'close'>
}

export const foldSessionsMessage = (args: {
  rows: readonly StreamSessionRow[] | undefined
  message: SessionsListMessage
}): readonly StreamSessionRow[] | undefined => {
  const { rows, message } = args
  if (message.type === 'snapshot') return message.rows
  // A delta before the first snapshot would otherwise replace the whole list with one row.
  if (rows === undefined) return undefined
  if (message.type === 'remove') return rows.filter((row) => row.sessionId !== message.sessionId)
  const exists = rows.some((row) => row.sessionId === message.row.sessionId)
  if (!exists) return [...rows, message.row]
  return rows.map((row) => (row.sessionId === message.row.sessionId ? message.row : row))
}

export const createSessionsList = (): SessionsList => {
  let rows: readonly StreamSessionRow[] | undefined
  const listeners = new Set<() => void>()
  return {
    handleMessage: (message) => {
      const next = foldSessionsMessage({ rows, message })
      if (next === rows) return
      rows = next
      for (const listener of [...listeners]) listener()
    },
    view: {
      getSnapshot: () => rows,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => void listeners.delete(listener)
      },
    },
  }
}
