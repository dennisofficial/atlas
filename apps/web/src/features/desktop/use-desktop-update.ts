'use client'

import { useCallback, useEffect, useState } from 'react'

import { EDesktopUpdateState, getDesktopUpdate, restartForUpdate } from './update-wire'
import { useIsDesktop } from './use-is-desktop'

export const UPDATE_POLL_MS = 15 * 60 * 1000

export type DesktopUpdateView = {
  ready: boolean
  version: string | undefined
  restarting: boolean
  dismissed: boolean
  restart: () => void
  dismiss: () => void
}

export function useDesktopUpdate(): DesktopUpdateView {
  const isDesktop = useIsDesktop()
  const [ready, setReady] = useState(false)
  const [version, setVersion] = useState<string | undefined>(undefined)
  const [restarting, setRestarting] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!isDesktop) return undefined
    let current = true
    const refresh = () => {
      getDesktopUpdate().then(
        (next) => {
          if (!current) return
          setReady(next.state === EDesktopUpdateState.Ready)
          setVersion(next.version)
        },
        () => undefined,
      )
    }
    refresh()
    const timer = setInterval(refresh, UPDATE_POLL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      current = false
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [isDesktop])

  const restart = useCallback(() => {
    setRestarting(true)
    restartForUpdate().catch(() => setRestarting(false))
  }, [])
  const dismiss = useCallback(() => setDismissed(true), [])

  return {
    ready: isDesktop && ready,
    version,
    restarting,
    dismissed,
    restart,
    dismiss,
  }
}
