'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Spinner } from '@dltech/atlas-ui/components/spinner'

import { sessionUserPresent } from '@/lib/auth-api'

import { FormError } from './auth-controls'
import { SignInRedirect } from './sign-in-redirect'

export enum ESessionState {
  Checking = 'checking',
  SignedIn = 'signed-in',
  SignedOut = 'signed-out',
  Failed = 'failed',
}

type GateState = { state: ESessionState; message: string }

export function useSessionState(): { gate: GateState; retry: () => void } {
  const [gate, setGate] = useState<GateState>({ state: ESessionState.Checking, message: '' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    sessionUserPresent().then(
      (present) => {
        if (!live) return
        setGate({ state: present ? ESessionState.SignedIn : ESessionState.SignedOut, message: '' })
      },
      (cause: unknown) => {
        if (!live) return
        const message = cause instanceof Error ? cause.message : 'Session check failed'
        setGate({ state: ESessionState.Failed, message })
      },
    )
    return () => {
      live = false
    }
  }, [attempt])

  const retry = useCallback(() => {
    setGate({ state: ESessionState.Checking, message: '' })
    setAttempt((value) => value + 1)
  }, [])

  return { gate, retry }
}

export function CheckingSession() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-svh items-center justify-center">
      <Spinner />
    </div>
  )
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
  if (gate.state === ESessionState.SignedOut) return <SignInRedirect />
  if (gate.state === ESessionState.Failed) {
    return <SessionFailed message={gate.message} onRetry={retry} />
  }
  return <CheckingSession />
}
