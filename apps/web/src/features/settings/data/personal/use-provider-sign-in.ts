'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  EOauthProvider,
  EProviderSignInFlow,
  EProviderSignInPoll,
  type ProviderSignInBegin,
} from '@dltech/atlas-wire/web'

import { errorMessageOf } from './error-message'
import {
  beginProviderSignIn,
  completeProviderSignIn,
  pollProviderSignIn,
} from './provider-sign-in-api'
import { pollSignInUntilSettled } from './provider-sign-in-poll'

export enum EProviderSignInState {
  Idle = 'idle',
  Starting = 'starting',
  AwaitingCode = 'awaiting-code',
  Submitting = 'submitting',
  Waiting = 'waiting',
  Failed = 'failed',
}

export type ProviderSignInFlow =
  | { status: EProviderSignInState.Idle }
  | { status: EProviderSignInState.Starting }
  | { status: EProviderSignInState.AwaitingCode; authorizeUrl: string }
  | { status: EProviderSignInState.Submitting; authorizeUrl: string }
  | {
      status: EProviderSignInState.Waiting
      userCode: string
      verificationUrl: string
    }
  | { status: EProviderSignInState.Failed; message: string }

export type ProviderSignInControl = {
  flow: ProviderSignInFlow
  start: () => void
  cancel: () => void
  submitCode: (code: string) => void
}

const IDLE: ProviderSignInFlow = { status: EProviderSignInState.Idle }
const EXPIRED_MESSAGE = 'That code expired'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function useProviderSignIn(args: {
  provider: EOauthProvider
  onChanged: () => void
}): ProviderSignInControl {
  const { provider, onChanged } = args
  const [flow, setFlow] = useState<ProviderSignInFlow>(IDLE)
  const run = useRef(0)
  const attempt = useRef<{ attemptId: string; authorizeUrl: string } | null>(null)

  useEffect(
    () => () => {
      run.current += 1
    },
    [],
  )

  const cancel = useCallback(() => {
    run.current += 1
    attempt.current = null
    setFlow(IDLE)
  }, [])

  const waitForApproval = useCallback(
    async (args: {
      begun: Extract<ProviderSignInBegin, { flow: EProviderSignInFlow.DeviceCode }>
      isCurrent: () => boolean
    }) => {
      const { begun, isCurrent } = args
      const result = await pollSignInUntilSettled({
        attemptId: begun.attemptId,
        intervalMs: begun.intervalMs,
        expiresInMs: begun.expiresInMs,
        poll: pollProviderSignIn,
        wait: sleep,
        now: Date.now,
        isCancelled: () => !isCurrent(),
      })
      if (result === null) return
      if (result.status === EProviderSignInPoll.Complete) {
        setFlow(IDLE)
        onChanged()
        return
      }
      setFlow({
        status: EProviderSignInState.Failed,
        message: EXPIRED_MESSAGE,
      })
    },
    [onChanged],
  )

  const start = useCallback(() => {
    run.current += 1
    const id = run.current
    const isCurrent = () => run.current === id
    attempt.current = null
    setFlow({ status: EProviderSignInState.Starting })
    void (async () => {
      try {
        const begun = await beginProviderSignIn(provider)
        if (!isCurrent()) return
        if (begun.flow === EProviderSignInFlow.PasteCode) {
          attempt.current = {
            attemptId: begun.attemptId,
            authorizeUrl: begun.authorizeUrl,
          }
          setFlow({
            status: EProviderSignInState.AwaitingCode,
            authorizeUrl: begun.authorizeUrl,
          })
          window.open(begun.authorizeUrl, '_blank', 'noopener')
          return
        }
        setFlow({
          status: EProviderSignInState.Waiting,
          userCode: begun.userCode,
          verificationUrl: begun.verificationUrl,
        })
        window.open(begun.verificationUrl, '_blank', 'noopener')
        await waitForApproval({ begun, isCurrent })
      } catch (error) {
        if (isCurrent())
          setFlow({
            status: EProviderSignInState.Failed,
            message: errorMessageOf(error),
          })
      }
    })()
  }, [provider, waitForApproval])

  const submitCode = useCallback(
    (code: string) => {
      const current = attempt.current
      if (current === null) return
      const id = run.current
      const isCurrent = () => run.current === id
      setFlow({
        status: EProviderSignInState.Submitting,
        authorizeUrl: current.authorizeUrl,
      })
      void completeProviderSignIn({ attemptId: current.attemptId, code })
        .then(() => {
          if (!isCurrent()) return
          attempt.current = null
          setFlow(IDLE)
          onChanged()
        })
        .catch((error: unknown) => {
          if (!isCurrent()) return
          setFlow({
            status: EProviderSignInState.Failed,
            message: errorMessageOf(error),
          })
        })
    },
    [onChanged],
  )

  return { flow, start, cancel, submitCode }
}
