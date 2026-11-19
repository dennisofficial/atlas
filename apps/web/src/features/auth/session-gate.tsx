'use client'

import { useCallback, type ReactNode } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'

import { ShellSkeleton } from '@/features/shell/shell-skeletons'
import { EQueryState } from '@/lib/use-cloud-query'
import { useSessionQuery } from '@/lib/use-session-query'

import { FormError } from './auth-controls'
import { SignInRedirect } from './sign-in-redirect'
import { WhitelistWall } from './whitelist-wall'

export enum ESessionState {
  Checking = 'checking',
  SignedIn = 'signed-in',
  SignedOut = 'signed-out',
  AwaitingAccess = 'awaiting-access',
  Failed = 'failed',
}

type GateState = { state: ESessionState; message: string }

export function useSessionState(): { gate: GateState; retry: () => void } {
  const query = useSessionQuery()
  const { reload } = query
  const retry = useCallback(() => reload(), [reload])

  if (query.state === EQueryState.Failed) {
    const message = query.error.message || 'Session check failed'
    return { gate: { state: ESessionState.Failed, message }, retry }
  }
  if (query.state === EQueryState.Loading) {
    return { gate: { state: ESessionState.Checking, message: '' }, retry }
  }
  if (query.data === null) return { gate: { state: ESessionState.SignedOut, message: '' }, retry }
  if (query.data.active === false) {
    return { gate: { state: ESessionState.AwaitingAccess, message: '' }, retry }
  }
  return { gate: { state: ESessionState.SignedIn, message: '' }, retry }
}

export function CheckingSession() {
  return <ShellSkeleton />
}

export function SessionFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-3 p-6">
      <FormError>{message}</FormError>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

export function SessionGate({ children }: { children: ReactNode }) {
  const { gate, retry } = useSessionState()
  if (gate.state === ESessionState.SignedIn) return <>{children}</>
  if (gate.state === ESessionState.AwaitingAccess) return <WhitelistWall />
  if (gate.state === ESessionState.SignedOut) return <SignInRedirect />
  if (gate.state === ESessionState.Failed) {
    return <SessionFailed message={gate.message} onRetry={retry} />
  }
  return <CheckingSession />
}
