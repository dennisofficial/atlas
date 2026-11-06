import {
  EStreamSubscribeKind,
  type StreamClientMessage,
  type StreamServerMessage,
  type StreamSessionRow,
} from '@dltech/atlas-protocol'

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
  id: string
  subscribeMessage(): StreamClientMessage
  handleMessage(message: SessionsListMessage): void
  view: Omit<FollowedSessionList, 'close'>
}

export const foldSessionsMessage = (args: {
  rows: readonly StreamSessionRow[] | undefined
  message: SessionsListMessage
}): readonly StreamSessionRow[] => {
  const { rows = [], message } = args
  if (message.type === 'snapshot') return message.rows
  if (message.type === 'remove') return rows.filter((row) => row.sessionId !== message.sessionId)
  const exists = rows.some((row) => row.sessionId === message.row.sessionId)
  if (!exists) return [...rows, message.row]
  return rows.map((row) => (row.sessionId === message.row.sessionId ? message.row : row))
}

export const createSessionsList = (args: {
  id: string
  projectId?: string | undefined
}): SessionsList => {
  let rows: readonly StreamSessionRow[] | undefined
  const listeners = new Set<() => void>()
  return {
    id: args.id,
    subscribeMessage: () => ({
      type: 'subscribe',
      id: args.id,
      kind: EStreamSubscribeKind.Sessions,
      ...(args.projectId === undefined ? {} : { projectId: args.projectId }),
    }),
    handleMessage: (message) => {
      rows = foldSessionsMessage({ rows, message })
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
