'use client'

import { useRouteParam } from '@/lib/route-param'

import { SignInRetryProvider } from '@/features/threads/sign-in/sign-in-retry'

import { SessionView } from './session-view'

export function SessionRoute() {
  const sessionId = useRouteParam('sessionId')
  return (
    <SignInRetryProvider sessionId={sessionId}>
      <SessionView key={sessionId} sessionId={sessionId} />
    </SignInRetryProvider>
  )
}
