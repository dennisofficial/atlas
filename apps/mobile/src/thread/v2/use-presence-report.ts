import type { ApiClient } from '@dltech/atlas-api-router'
import { EClientSurface } from '@dltech/atlas-core'
import { type PresenceState, startPresenceReports } from '@dltech/atlas-notifications/client'
import { useEffect } from 'react'
import { AppState } from 'react-native'

import { installClientId } from '../../storage/install-client-id'
import { presenceStateOf } from './presence-state'

export function usePresenceReport(args: { api: ApiClient | undefined; sessionId: string | null }) {
  const { api, sessionId } = args
  useEffect(() => {
    if (api === undefined) return undefined
    let cancelled = false
    let stop: (() => void) | undefined

    const begin = async (): Promise<void> => {
      const clientId = await installClientId()
      if (cancelled) return
      stop = startPresenceReports({
        read: () => presenceStateOf({ sessionId, appState: AppState.currentState }),
        report: (state: PresenceState) => {
          void api.notifications.reportPresence
            .mutate({ clientId, surface: EClientSurface.Ios, ...state })
            .catch(() => undefined)
        },
        subscribe: (onChange) => {
          const subscription = AppState.addEventListener('change', onChange)
          return () => subscription.remove()
        },
        clock: {
          setInterval: (handler, ms) => setInterval(handler, ms),
          clearInterval: (handle) => clearInterval(handle),
        },
      })
    }

    void begin()
    return () => {
      cancelled = true
      stop?.()
    }
  }, [api, sessionId])
}
