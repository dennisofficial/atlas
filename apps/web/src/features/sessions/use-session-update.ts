'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  checkForUpdate,
  type DesktopUpdate,
  EDesktopUpdateState,
  EWebPayloadState,
  restartForUpdate,
} from '@/features/desktop/update-wire'
import { useIsDesktop } from '@/features/desktop/use-is-desktop'

export enum ESessionUpdatePhase {
  Web = 'web',
  Checking = 'checking',
  Ready = 'ready',
  Current = 'current',
  Failed = 'failed',
  Restarting = 'restarting',
}

export type SessionUpdate = {
  phase: ESessionUpdatePhase
  version: string | undefined
  act: () => void
}

export const phaseOfUpdate = (update: DesktopUpdate): ESessionUpdatePhase => {
  if (update.state === EDesktopUpdateState.Ready) return ESessionUpdatePhase.Ready
  if (update.state === EDesktopUpdateState.Restarting) return ESessionUpdatePhase.Restarting
  if (update.web?.state === EWebPayloadState.Ready) return ESessionUpdatePhase.Ready
  return update.error === undefined ? ESessionUpdatePhase.Current : ESessionUpdatePhase.Failed
}

export const versionOfUpdate = (update: DesktopUpdate): string | undefined =>
  update.state === EDesktopUpdateState.Ready
    ? update.version
    : (update.web?.version ?? update.version)

export function useSessionUpdate(): SessionUpdate {
  const isDesktop = useIsDesktop()
  const [phase, setPhase] = useState<ESessionUpdatePhase>(
    isDesktop ? ESessionUpdatePhase.Checking : ESessionUpdatePhase.Web,
  )
  const [version, setVersion] = useState<string | undefined>(undefined)

  const check = useCallback(() => {
    checkForUpdate().then(
      (update) => {
        setPhase(phaseOfUpdate(update))
        setVersion(versionOfUpdate(update))
      },
      () => setPhase(ESessionUpdatePhase.Failed),
    )
  }, [])

  useEffect(() => {
    if (!isDesktop) return undefined
    let current = true
    checkForUpdate().then(
      (update) => {
        if (!current) return
        setPhase(phaseOfUpdate(update))
        setVersion(versionOfUpdate(update))
      },
      () => {
        if (current) setPhase(ESessionUpdatePhase.Failed)
      },
    )
    return () => {
      current = false
    }
  }, [isDesktop])

  const act = useCallback(() => {
    if (!isDesktop) {
      window.location.reload()
      return
    }
    if (phase === ESessionUpdatePhase.Ready) {
      setPhase(ESessionUpdatePhase.Restarting)
      restartForUpdate().catch(() => setPhase(ESessionUpdatePhase.Failed))
      return
    }
    setPhase(ESessionUpdatePhase.Checking)
    check()
  }, [check, isDesktop, phase])

  return { phase, version, act }
}
