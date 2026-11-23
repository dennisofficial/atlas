'use client'

import { EClientSurface } from '@dltech/atlas-core'
import { type PresenceState, startPresenceReports } from '@dltech/atlas-notifications/client'
import { useEffect } from 'react'

import { isDesktopHost } from '@/features/desktop/desktop-attributes'
import { installClientId } from '@/lib/client-id'

import { reportPresence, reportPresenceAway } from './notify-api'

const FOCUS_EVENTS = ['focus', 'blur', 'visibilitychange'] as const

export const presenceStateOf = (args: {
  sessionId: string | null
  visibilityState: string
  focused: boolean
}): PresenceState => ({
  sessionId: args.sessionId,
  foreground: args.visibilityState === 'visible' && args.focused,
})

export const surfaceOf = (host: object): EClientSurface =>
  isDesktopHost(host) ? EClientSurface.Desktop : EClientSurface.Web

export function usePresenceReport(args: { sessionId: string | null }): void {
  const { sessionId } = args
  useEffect(() => {
    const clientId = installClientId()
    const surface = surfaceOf(window)
    const stop = startPresenceReports({
      read: () =>
        presenceStateOf({
          sessionId,
          visibilityState: document.visibilityState,
          focused: document.hasFocus(),
        }),
      report: (state) => {
        void reportPresence({ clientId, surface, ...state }).catch(() => undefined)
      },
      subscribe: (onChange) => {
        for (const event of FOCUS_EVENTS) window.addEventListener(event, onChange)
        return () => {
          for (const event of FOCUS_EVENTS) window.removeEventListener(event, onChange)
        }
      },
      clock: {
        setInterval: (handler, ms) => window.setInterval(handler, ms),
        clearInterval: (handle) => window.clearInterval(handle),
      },
    })
    const handlePageHide = (): void => {
      void reportPresenceAway({ clientId, surface, sessionId, foreground: false }).catch(
        () => undefined,
      )
    }
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      stop()
    }
  }, [sessionId])
}
