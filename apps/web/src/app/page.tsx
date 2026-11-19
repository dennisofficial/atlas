'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { QueryProvider } from '@/lib/query-provider'
import {
  CheckingSession,
  ESessionState,
  SessionFailed,
  useSessionState,
} from '@/features/auth/session-gate'
import { WhitelistWall } from '@/features/auth/whitelist-wall'

function RootRedirect() {
  const router = useRouter()
  const { gate, retry } = useSessionState()

  useEffect(() => {
    if (gate.state === ESessionState.SignedIn) router.replace('/threads')
    if (gate.state === ESessionState.SignedOut) router.replace('/sign-in')
  }, [gate.state, router])

  if (gate.state === ESessionState.Failed) {
    return <SessionFailed message={gate.message} onRetry={retry} />
  }
  if (gate.state === ESessionState.AwaitingAccess) return <WhitelistWall />
  return <CheckingSession />
}

export default function RootPage() {
  return (
    <QueryProvider>
      <RootRedirect />
    </QueryProvider>
  )
}
