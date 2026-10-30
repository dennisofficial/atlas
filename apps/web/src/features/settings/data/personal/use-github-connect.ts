'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  EGithubPollStatus,
  type GithubDeviceCodes,
  type GithubPollResult,
} from '@dltech/atlas-wire/web'

import { beginGithubConnect, disconnectGithub, pollGithubConnect } from './github-api'
import { pollUntilSettled } from './github-poll'

export enum EGithubFlow {
  Idle = 'idle',
  Starting = 'starting',
  Waiting = 'waiting',
  Failed = 'failed',
}

export type GithubFlow =
  | { status: EGithubFlow.Idle }
  | { status: EGithubFlow.Starting }
  | { status: EGithubFlow.Waiting; codes: GithubDeviceCodes }
  | { status: EGithubFlow.Failed; message: string }

export type GithubConnectControl = {
  flow: GithubFlow
  disconnecting: boolean
  connect: () => void
  cancel: () => void
  disconnect: () => void
}

const IDLE: GithubFlow = { status: EGithubFlow.Idle }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong'

function failureOf(
  result: Exclude<GithubPollResult, { status: EGithubPollStatus.Connected }>,
): string {
  if (result.status === EGithubPollStatus.Denied) return 'GitHub access was refused'
  if (result.status === EGithubPollStatus.MissingScopes) {
    return `GitHub didn't grant ${result.missing.join(', ')}. Approve every permission to continue.`
  }
  return 'That code expired'
}

export function useGithubConnect(args: { onChanged: () => void }): GithubConnectControl {
  const { onChanged } = args
  const [flow, setFlow] = useState<GithubFlow>(IDLE)
  const [disconnecting, setDisconnecting] = useState(false)
  const run = useRef(0)

  useEffect(
    () => () => {
      run.current += 1
    },
    [],
  )

  const cancel = useCallback(() => {
    run.current += 1
    setFlow(IDLE)
  }, [])

  const connect = useCallback(() => {
    run.current += 1
    const id = run.current
    const isCurrent = () => run.current === id
    setFlow({ status: EGithubFlow.Starting })
    void (async () => {
      try {
        const codes = await beginGithubConnect()
        if (!isCurrent()) return
        setFlow({ status: EGithubFlow.Waiting, codes })
        window.open(codes.verificationUrl, '_blank', 'noopener')
        const result = await pollUntilSettled({
          codes,
          poll: pollGithubConnect,
          wait: sleep,
          now: Date.now,
          isCancelled: () => !isCurrent(),
        })
        if (result === null) return
        if (result.status === EGithubPollStatus.Connected) {
          setFlow(IDLE)
          onChanged()
          return
        }
        setFlow({ status: EGithubFlow.Failed, message: failureOf(result) })
      } catch (error) {
        if (isCurrent()) setFlow({ status: EGithubFlow.Failed, message: messageOf(error) })
      }
    })()
  }, [onChanged])

  const disconnect = useCallback(() => {
    run.current += 1
    setFlow(IDLE)
    setDisconnecting(true)
    void disconnectGithub()
      .then(onChanged)
      .catch((error: unknown) => setFlow({ status: EGithubFlow.Failed, message: messageOf(error) }))
      .finally(() => setDisconnecting(false))
  }, [onChanged])

  return { flow, disconnecting, connect, cancel, disconnect }
}
