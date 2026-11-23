import type { ApiClient } from '@dltech/atlas-api-router'
import { EClientSurface } from '@dltech/atlas-core'
import { type PresenceState, startPresenceReports } from '@dltech/atlas-notifications/client'
import { randomUUID } from 'expo-crypto'
import { useEffect } from 'react'
import { AppState } from 'react-native'

import { kvJsonStore } from '../../storage/kv-json-store'
import { presenceStateOf } from './presence-state'

const CLIENT_DATABASE = 'atlas-client'
const CLIENT_ID_NAME = 'clientId'

const clientIdOf = async (): Promise<string> => {
  const store = kvJsonStore({ database: CLIENT_DATABASE })
  const stored = await store.read(CLIENT_ID_NAME)
  if (typeof stored === 'string' && stored.length > 0) return stored
  const clientId = randomUUID()
  await store.write(CLIENT_ID_NAME, clientId)
  return clientId
}

export function usePresenceReport(args: { api: ApiClient | undefined; sessionId: string | null }) {
  const { api, sessionId } = args
  useEffect(() => {
    if (api === undefined) return undefined
    let cancelled = false
    let stop: (() => void) | undefined

    const begin = async (): Promise<void> => {
      const clientId = await clientIdOf()
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
