import type { EReportKind, SessionStatus } from '@dltech/atlas-core'

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

export type SessionMessage = { queued: true } | { refused: string }

export type SessionReport = { kind: EReportKind; text: string }

export type PodSessions = {
  spawn(args: {
    title?: string | undefined
    brief?: string | undefined
    nested?: boolean | undefined
  }): Promise<SpawnedSession>
  message(args: { sessionId: string; text: string }): Promise<SessionMessage>
  report(args: SessionReport): Promise<SessionMessage>
  list(): Promise<readonly SessionBrief[]>
}

export const EMPTY_SESSIONS: PodSessions = Object.freeze({
  spawn: async () => {
    throw new Error('this session cannot spawn sessions')
  },
  message: async () => ({
    refused: 'this session cannot message other sessions',
  }),
  report: async () => ({ refused: 'this session cannot report to a spawner' }),
  list: async () => [],
})
