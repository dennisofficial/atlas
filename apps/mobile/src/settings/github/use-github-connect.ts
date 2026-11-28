import type { ApiClient } from '@dltech/atlas-api-router'
import { EReturnResult, stateOfStartLink } from '@dltech/atlas-core'
import { useCallback, useEffect, useRef, useState } from 'react'

import { openBrowserReturn, useReturnOutcome } from '../../browser-return'
import { EGithubFlow, githubFlowOfReturn, type GithubFlow } from './github-flow'

export { EGithubFlow, type GithubFlow } from './github-flow'

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
    setFlow(githubFlowOfReturn(outcome))
    if (outcome.result === EReturnResult.Connected) onChanged()
  }, [state, outcome, onChanged])

  const cancel = useCallback(() => {
    run.current += 1
    setFlow(IDLE)
  }, [])

  const connect = useCallback(() => {
    if (api === undefined) return
    const id = ++run.current
    setFlow({ status: EGithubFlow.Starting })
    void (async () => {
      try {
        const { url } = await api.github.beginRedirect.mutate()
        if (run.current !== id) return
        setFlow({ status: EGithubFlow.Waiting, url })
        await openBrowserReturn({ url })
      } catch (error) {
        if (run.current === id) setFlow({ status: EGithubFlow.Failed, message: messageOf(error) })
      }
    })()
  }, [api])

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
