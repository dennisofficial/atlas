import { useEffect } from 'react'

import { EClientSurface } from '@dltech/atlas-core'
import { type PresenceState, startPresenceReports } from '@dltech/atlas-notifications/client'

import type { SessionApi } from './session-api'

export type PresenceReporter = { report: (state: PresenceState) => void; stop: () => void }

export const newClientId = (): string => crypto.randomUUID()

export const terminalPresenceStateOf = (args: { sessionId: string | null }): PresenceState => ({
  sessionId: args.sessionId,
  foreground: true,
})

export const presenceReporterOf = (args: {
  api: SessionApi
  clientId: string
}): PresenceReporter => {
  const report = (state: PresenceState): void => {
    void args.api
      .reportPresence({ clientId: args.clientId, surface: EClientSurface.Terminal, ...state })
      .catch(() => undefined)
  }
  return { report, stop: () => undefined }
}

export function usePresenceReport(args: {
  api: SessionApi | null
  sessionId: string | null
  clientId: string
}): void {
  const { api, sessionId, clientId } = args

  useEffect(() => {
    if (api === null) return

    const reporter = presenceReporterOf({ api, clientId })
    const stop = startPresenceReports({
      read: () => terminalPresenceStateOf({ sessionId }),
      report: reporter.report,
      subscribe: () => () => undefined,
      clock: {
        setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
        clearInterval: (handle) => globalThis.clearInterval(handle),
      },
    })

    return () => {
      stop()
      reporter.report({ sessionId: null, foreground: false })
    }
  }, [api, clientId, sessionId])
}
