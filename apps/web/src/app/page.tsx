'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import {
  CheckingSession,
  ESessionState,
  SessionFailed,
  useSessionState,
} from '@/features/auth/session-gate'

export default function RootPage() {
  const router = useRouter()
  const { gate, retry } = useSessionState()

  useEffect(() => {
    if (gate.state === ESessionState.SignedIn) router.replace('/threads')
    if (gate.state === ESessionState.SignedOut) router.replace('/sign-in')
  }, [gate.state, router])

  if (gate.state === ESessionState.Failed) {
    return <SessionFailed message={gate.message} onRetry={retry} />
  }
  return <CheckingSession />
}
