'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { EReturnResult, stateOfStartLink } from '@dltech/atlas-core'
import { toast } from 'sonner'
import { openBrowserReturn } from '@/features/auth/browser-return/open-browser-return'
import { useReturnOutcome } from '@/features/auth/browser-return/use-return-outcome'
import { beginGithubConnect, disconnectGithub } from './github-api'

export enum EGithubFlow {
  Idle = 'idle',
  Starting = 'starting',
  Waiting = 'waiting',
  Failed = 'failed',
}

export type GithubFlow =
  | { status: EGithubFlow.Idle }
  | { status: EGithubFlow.Starting }
  | { status: EGithubFlow.Waiting; url: string }
  | { status: EGithubFlow.Failed; message: string }

export type GithubConnectControl = {
  flow: GithubFlow
  disconnecting: boolean
  connect: () => void
  cancel: () => void
  disconnect: () => void
}

const IDLE: GithubFlow = { status: EGithubFlow.Idle }
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong'

export function useGithubConnect(args: { onChanged: () => void }): GithubConnectControl {
  const { onChanged } = args
  const [flow, setFlow] = useState<GithubFlow>(IDLE)
  const [disconnecting, setDisconnecting] = useState(false)
  const run = useRef(0)
  const state = flow.status === EGithubFlow.Waiting ? stateOfStartLink(flow.url) : undefined
  const outcome = useReturnOutcome({ state, durable: undefined })

  useEffect(
    () => () => {
      run.current += 1
    },
    [],
  )
  useEffect(() => {
    if (state === undefined || outcome === undefined) return
    if (outcome.result === EReturnResult.Connected) {
      setFlow(IDLE)
      toast.success('GitHub connected')
      onChanged()
      return
    }
    const message = outcome.reason ?? 'GitHub access was refused'
    setFlow({ status: EGithubFlow.Failed, message })
    toast.error(message)
  }, [state, outcome, onChanged])

  const cancel = useCallback(() => {
    run.current += 1
    setFlow(IDLE)
  }, [])

  const connect = useCallback(() => {
    const id = ++run.current
    setFlow({ status: EGithubFlow.Starting })
    void beginGithubConnect()
      .then(({ url }) => {
        if (run.current !== id) return
        setFlow({ status: EGithubFlow.Waiting, url })
        openBrowserReturn({ url })
      })
      .catch((error: unknown) => {
        if (run.current === id) setFlow({ status: EGithubFlow.Failed, message: messageOf(error) })
      })
  }, [])

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
