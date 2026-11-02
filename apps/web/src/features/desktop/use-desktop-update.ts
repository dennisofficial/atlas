'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  type DesktopUpdate,
  EDesktopUpdateState,
  getDesktopUpdate,
  restartForUpdate,
} from './update-wire'
import { useIsDesktop } from './use-is-desktop'

export const UPDATE_POLL_MS = 60 * 1000
export const RESTART_POLL_MS = 2 * 1000

export type DesktopUpdateView = {
  ready: boolean
  version: string | undefined
  restarting: boolean
  error: string | undefined
  dismissed: boolean
  restart: () => void
  dismiss: () => void
}

const IDLE: DesktopUpdate = { state: EDesktopUpdateState.Idle }

export function useDesktopUpdate(): DesktopUpdateView {
  const isDesktop = useIsDesktop()
  const [update, setUpdate] = useState<DesktopUpdate>(IDLE)
  const [requested, setRequested] = useState(false)
  const [requestError, setRequestError] = useState<string | undefined>(undefined)
  const [dismissed, setDismissed] = useState(false)

  const restarting = requested || update.state === EDesktopUpdateState.Restarting
  const pollMs = restarting ? RESTART_POLL_MS : UPDATE_POLL_MS

  useEffect(() => {
    if (!isDesktop) return undefined
    let current = true
    const refresh = () => {
      getDesktopUpdate().then(
        (next) => {
          if (!current) return
          setUpdate(next)
          if (next.error !== undefined) setRequested(false)
        },
        () => undefined,
      )
    }
    refresh()
    const timer = setInterval(refresh, pollMs)
    window.addEventListener('focus', refresh)
    return () => {
      current = false
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [isDesktop, pollMs])

  const restart = useCallback(() => {
    setRequested(true)
    setRequestError(undefined)
    setUpdate((previous) => ({
      ...previous,
      state: EDesktopUpdateState.Restarting,
      error: undefined,
    }))
    restartForUpdate().catch((error: unknown) => {
      setRequested(false)
      setRequestError(error instanceof Error ? error.message : String(error))
    })
  }, [])
  const dismiss = useCallback(() => setDismissed(true), [])

  return {
    ready: isDesktop && update.state !== EDesktopUpdateState.Idle,
    version: update.version,
    restarting,
    error: restarting ? undefined : (requestError ?? update.error),
    dismissed,
    restart,
    dismiss,
  }
}
