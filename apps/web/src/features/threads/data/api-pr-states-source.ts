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

type StatesListener = (states: readonly PrStateWire[]) => void
type PrStatesSource = ReturnType<typeof createSource>

const sources = new WeakMap<ApiPrStatesSubscribe, PrStatesSource>()

function createSource(subscribe: ApiPrStatesSubscribe) {
  const byKey = new Map<string, PrStateWire>()
  const listeners = new Set<StatesListener>()
  let states: readonly PrStateWire[] = []
  let stopped = false
  let generation = 0
  let failures = 0
  let current: { unsubscribe: () => void } | undefined
  let retry: ReturnType<typeof setTimeout> | undefined

  const open = () => {
    if (stopped) return
    generation += 1
    const mine = generation
    const isCurrent = () => !stopped && mine === generation

    const handleEnded = () => {
      if (!isCurrent()) return
      generation += 1
      current?.unsubscribe()
      current = undefined
      failures += 1
      retry = setTimeout(open, reconnectDelayMs(failures))
    }

    const handleData = (frame: GithubPrStatesFrame) => {
      if (!isCurrent()) return
      failures = 0
      if (frame.type !== EGithubPrStatesFrame.PrState) return
      const state = prStateWireOfApi(frame.state)
      if (state === undefined) return
      byKey.set(pullRequestKeyOf(state), state)
      states = [...byKey.values()]
      for (const listener of listeners) listener(states)
    }

    try {
      const subscription = subscribe({
        onData: handleData,
        onError: handleEnded,
        onComplete: handleEnded,
      })
      if (isCurrent()) current = subscription
      else subscription.unsubscribe()
    } catch {
      handleEnded()
    }
  }

  return {
    add: (listener: StatesListener) => {
      listeners.add(listener)
      if (states.length > 0) listener(states)
      if (listeners.size === 1) open()
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return
        stopped = true
        generation += 1
        clearTimeout(retry)
        current?.unsubscribe()
        sources.delete(subscribe)
      }
    },
  }
}

export function subscribeApiPrStates(args: {
  subscribe: ApiPrStatesSubscribe
  onStates: StatesListener
}): () => void {
  let source = sources.get(args.subscribe)
  if (source === undefined) {
    source = createSource(args.subscribe)
    sources.set(args.subscribe, source)
  }
  return source.add((states) => args.onStates(states))
}
