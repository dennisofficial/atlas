export type SessionBrief = {
  sessionId: string
  title: string | null
  spawnedBy: string | null
  archivedAt: string | null
  current: boolean
}

export type SpawnedSession = { sessionId: string; mainThreadId: string }

export type SessionMessage = { queued: true } | { refused: string }

export type PodSessions = {
  spawn(args: {
    title?: string | undefined
    brief?: string | undefined
    intoPod?: boolean | undefined
  }): Promise<SpawnedSession>
  message(args: { sessionId: string; text: string }): Promise<SessionMessage>
  list(): Promise<readonly SessionBrief[]>
}

export const EMPTY_SESSIONS: PodSessions = Object.freeze({
  spawn: async () => {
    throw new Error('this session cannot spawn sessions')
  },
  message: async () => ({ refused: 'this session cannot message other sessions' }),
  list: async () => [],
})
