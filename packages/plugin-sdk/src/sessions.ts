import type { SessionStatus, SpawnFile } from '@dltech/atlas-core'

export type SessionBrief = {
  sessionId: string
  title: string | null
  spawnedBy: string | null
  nested: boolean
  archivedAt: string | null
  current: boolean
  status: SessionStatus | null
}

export type SpawnedSession = { sessionId: string; mainThreadId: string }

export type SessionArchive = { archived: true; already: boolean } | { refused: string }

export type PodSessions = {
  spawn(args: {
    title?: string | undefined
    brief?: string | undefined
    nested?: boolean | undefined
    files?: readonly SpawnFile[] | undefined
  }): Promise<SpawnedSession>
  list(): Promise<readonly SessionBrief[]>
  teammates(): Promise<readonly SessionBrief[]>
  archive(args: { sessionId: string }): Promise<SessionArchive>
}

export const EMPTY_SESSIONS: PodSessions = Object.freeze({
  spawn: async () => {
    throw new Error('this session cannot spawn sessions')
  },
  list: async () => [],
  teammates: async () => [],
  archive: async () => ({ refused: 'this session cannot archive sessions' }),
})
