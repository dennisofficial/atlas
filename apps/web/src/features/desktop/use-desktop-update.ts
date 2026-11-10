'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  type DesktopUpdate,
  EDesktopUpdateState,
  EWebPayloadState,
  getDesktopUpdate,
  restartForUpdate,
} from './update-wire'
import { useIsDesktop } from './use-is-desktop'

export const UPDATE_POLL_MS = 60 * 1000
export const RESTART_POLL_MS = 2 * 1000
// A merge publishes a payload every few minutes, so a card for every one is a permanent fixture.
// After a reload the card stays away this long; the menu's Check for Updates still applies one.
export const INTERFACE_QUIET_MS = 15 * 60 * 1000
const RELOADED_AT_KEY = 'atlas.interface.reloaded-at'

function readReloadedAt(): number | undefined {
  try {
    const raw = window.localStorage.getItem(RELOADED_AT_KEY)
    const parsed = raw === null ? Number.NaN : Number(raw)
    return Number.isFinite(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function rememberReload(): number {
  const now = Date.now()
  try {
    window.localStorage.setItem(RELOADED_AT_KEY, String(now))
  } catch {
    return now
  }
  return now
}

export enum EDesktopUpdateKind {
  App = 'app',
  Interface = 'interface',
}

export type DesktopUpdateView = {
  ready: boolean
  kind: EDesktopUpdateKind | undefined
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
  const [requestedFor, setRequestedFor] = useState<EDesktopUpdateKind | undefined>(undefined)
  const [requestError, setRequestError] = useState<string | undefined>(undefined)
  const [dismissed, setDismissed] = useState(false)

  const restarting = requested || update.state === EDesktopUpdateState.Restarting
  const pollMs = restarting ? RESTART_POLL_MS : UPDATE_POLL_MS
  const [reloadedAt, setReloadedAt] = useState<number | undefined>(readReloadedAt)
  const appReady = update.state !== EDesktopUpdateState.Idle
  const quiet = reloadedAt !== undefined && Date.now() - reloadedAt < INTERFACE_QUIET_MS
  const interfaceReady = update.web?.state === EWebPayloadState.Ready && !quiet
  const liveKind = appReady
    ? EDesktopUpdateKind.App
    : interfaceReady
      ? EDesktopUpdateKind.Interface
      : undefined
  const kind = requested ? (requestedFor ?? liveKind) : liveKind

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
    setRequestedFor(kind)
    if (kind === EDesktopUpdateKind.Interface) setReloadedAt(rememberReload())
    setRequested(true)
    setRequestError(undefined)
    setUpdate((previous) => ({
      ...previous,
      state: EDesktopUpdateState.Restarting,
      error: undefined,
    }))
    restartForUpdate().catch((error: unknown) => {
      setRequested(false)
      setRequestedFor(undefined)
      setRequestError(error instanceof Error ? error.message : String(error))
    })
  }, [kind])
  const dismiss = useCallback(() => setDismissed(true), [])

  return {
    ready: isDesktop && kind !== undefined,
    kind,
    version: kind === EDesktopUpdateKind.Interface ? update.web?.version : update.version,
    restarting,
    error: restarting ? undefined : (requestError ?? update.error),
    dismissed,
    restart,
    dismiss,
  }
}
