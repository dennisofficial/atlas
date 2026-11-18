import type { SessionLog } from './session-log'

export type SessionArchiveState = { sessionId: string; archived: boolean }

export const sessionLogDeletionsOf = (args: {
  cached: readonly string[]
  sessions: readonly SessionArchiveState[]
}): readonly string[] => {
  const archived = new Set(
    args.sessions.filter((session) => session.archived).map((session) => session.sessionId),
  )
  const live = new Set(args.sessions.map((session) => session.sessionId))
  return args.cached.filter((sessionId) => archived.has(sessionId) || !live.has(sessionId))
}

export const gcSessionLog = async (args: {
  log: SessionLog
  sessions: readonly SessionArchiveState[]
}): Promise<void> => {
  const cached = await args.log.listSessions().catch(() => [] as readonly string[])
  const stale = sessionLogDeletionsOf({ cached, sessions: args.sessions })
  await Promise.all(
    stale.map((sessionId) => args.log.deleteSession(sessionId).catch(() => undefined)),
  )
}
