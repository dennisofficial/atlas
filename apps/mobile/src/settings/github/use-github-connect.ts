import type { ApiClient } from '@dltech/atlas-api-router'
import {
  EGithubPollStatus,
  type GithubDeviceCodes,
  type GithubPollResult,
} from '@dltech/atlas-wire/web'
import { githubFailureOf, pollUntilSettled } from '@dltech/atlas-client/settings'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as WebBrowser from 'expo-web-browser'

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

export const useGithubConnect = ({
  api,
  onChanged,
}: {
  api: ApiClient | undefined
  onChanged: () => void
}): GithubConnectControl => {
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
    if (api === undefined) return
    run.current += 1
    const id = run.current
    const isCurrent = () => run.current === id
    setFlow({ status: EGithubFlow.Starting })
    void (async () => {
      try {
        const codes = await api.github.beginConnect.mutate()
        if (!isCurrent()) return
        setFlow({ status: EGithubFlow.Waiting, codes })
        void WebBrowser.openBrowserAsync(codes.verificationUrl)
        const result = await pollUntilSettled({
          codes,
          poll: (deviceCode: string): Promise<GithubPollResult> =>
            api.github.pollConnect.mutate({ deviceCode }),
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
        setFlow({ status: EGithubFlow.Failed, message: githubFailureOf(result) })
      } catch (error) {
        if (isCurrent()) setFlow({ status: EGithubFlow.Failed, message: messageOf(error) })
      }
    })()
  }, [api, onChanged])

  const disconnect = useCallback(() => {
    if (api === undefined) return
    run.current += 1
    setFlow(IDLE)
    setDisconnecting(true)
    void api.github.disconnect
      .mutate()
      .then(onChanged)
      .catch((error: unknown) => setFlow({ status: EGithubFlow.Failed, message: messageOf(error) }))
      .finally(() => setDisconnecting(false))
  }, [api, onChanged])

  return { flow, disconnecting, connect, cancel, disconnect }
}
