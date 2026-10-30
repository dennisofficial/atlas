'use client'

import { useEffect, useEffectEvent, useState } from 'react'

import {
  desktopAuthStatus,
  EDesktopAuthState,
  startDesktopSignIn,
} from '@/features/desktop/desktop-auth'

export enum EDesktopSignInPhase {
  Idle = 'idle',
  Starting = 'starting',
  Pending = 'pending',
  Expired = 'expired',
  Denied = 'denied',
  Failed = 'failed',
}

export const DESKTOP_POLL_MS = 2000

export function useDesktopSignIn({
  onSignedIn,
  pollMs = DESKTOP_POLL_MS,
}: {
  onSignedIn: () => void
  pollMs?: number
}) {
  const [phase, setPhase] = useState(EDesktopSignInPhase.Idle)
  const [userCode, setUserCode] = useState('')
  const handleSignedIn = useEffectEvent(onSignedIn)

  const start = async () => {
    setPhase(EDesktopSignInPhase.Starting)
    try {
      const started = await startDesktopSignIn()
      setUserCode(started.userCode)
      setPhase(EDesktopSignInPhase.Pending)
    } catch {
      setPhase(EDesktopSignInPhase.Failed)
    }
  }

  useEffect(() => {
    if (phase !== EDesktopSignInPhase.Pending) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const status = await desktopAuthStatus()
        if (!live) return
        if (status.state === EDesktopAuthState.SignedIn) return handleSignedIn()
        if (status.state === EDesktopAuthState.Denied) return setPhase(EDesktopSignInPhase.Denied)
        if (status.state !== EDesktopAuthState.Pending) return setPhase(EDesktopSignInPhase.Expired)
      } catch {
        if (!live) return
      }
      timer = setTimeout(() => void tick(), pollMs)
    }
    timer = setTimeout(() => void tick(), pollMs)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [phase, pollMs])

  return { phase, userCode, start }
}
