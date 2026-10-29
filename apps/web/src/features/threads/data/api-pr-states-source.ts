import {
  EGithubPrStatesFrame,
  type GithubPrStatesFrame,
  type PrStateWire,
} from '@dltech/atlas-wire/web'

import { prStateWireOfApi } from './pr-states-merge'
import { pullRequestKeyOf } from './pull-request-entries'
import { reconnectDelayMs } from './thread-signals'

export type ApiPrStatesSubscribe = (handlers: {
  onData: (frame: GithubPrStatesFrame) => void
  onError: (failure: unknown) => void
  onComplete: () => void
}) => { unsubscribe: () => void }

export function subscribeApiPrStates(args: {
  subscribe: ApiPrStatesSubscribe
  onStates: (states: readonly PrStateWire[]) => void
}): () => void {
  const byKey = new Map<string, PrStateWire>()
  let stopped = false
  let failures = 0
  let current: { unsubscribe: () => void } | undefined
  let retry: ReturnType<typeof setTimeout> | undefined

  const handleData = (frame: GithubPrStatesFrame) => {
    failures = 0
    if (frame.type !== EGithubPrStatesFrame.PrState) return
    const state = prStateWireOfApi(frame.state)
    if (state === undefined) return
    byKey.set(pullRequestKeyOf(state), state)
    args.onStates([...byKey.values()])
  }

  const open = () => {
    if (stopped) return
    current = args.subscribe({
      onData: handleData,
      onError: handleEnded,
      onComplete: handleEnded,
    })
  }

  function handleEnded() {
    if (stopped) return
    current?.unsubscribe()
    failures += 1
    retry = setTimeout(open, reconnectDelayMs(failures))
  }

  open()
  return () => {
    stopped = true
    clearTimeout(retry)
    current?.unsubscribe()
  }
}
