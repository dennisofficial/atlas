import type { SessionWindow } from './session-window'

export type SessionCache = {
  load(sessionId: string): Promise<SessionWindow | undefined>
  save(args: { sessionId: string; window: SessionWindow }): Promise<void>
}

export const memorySessionCache = (): SessionCache => {
  const windows = new Map<string, SessionWindow>()
  return {
    load: (sessionId) => Promise.resolve(windows.get(sessionId)),
    save: ({ sessionId, window }) => {
      windows.set(sessionId, window)
      return Promise.resolve()
    },
  }
}
