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
// The interface is expected to move constantly, so the card is only for a person who is looking at
// it. A payload whose hash has already been applied is never offered twice, and one that arrives
// while the window is in the background reloads itself.
const APPLIED_HASH_KEY = 'atlas.interface.applied-hash'

function readAppliedHash(): string | undefined {
  try {
    return window.localStorage.getItem(APPLIED_HASH_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function rememberAppliedHash(hash: string): void {
  try {
    window.localStorage.setItem(APPLIED_HASH_KEY, hash)
  } catch {
    undefined
  }
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
  const [appliedHash, setAppliedHash] = useState<string | undefined>(readAppliedHash)
  const interfaceHash = update.web?.hash
  const appReady = update.state !== EDesktopUpdateState.Idle
  const interfaceReady =
    update.web?.state === EWebPayloadState.Ready && interfaceHash !== appliedHash
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

  useEffect(() => {
    if (!isDesktop || !interfaceReady || interfaceHash === undefined) return
    if (typeof document.hasFocus === 'function' && document.hasFocus()) return
    setAppliedHash(interfaceHash)
    rememberAppliedHash(interfaceHash)
    void restartForUpdate().catch(() => undefined)
  }, [isDesktop, interfaceReady, interfaceHash])

  const restart = useCallback(() => {
    setRequestedFor(kind)
    if (kind === EDesktopUpdateKind.Interface && interfaceHash !== undefined) {
      setAppliedHash(interfaceHash)
      rememberAppliedHash(interfaceHash)
    }
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
