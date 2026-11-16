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

type Consumer = {
  onStates: (states: readonly PrStateWire[]) => void
}

const sources = new WeakMap<ApiPrStatesSubscribe, ReturnType<typeof createSource>>()

function createSource(subscribe: ApiPrStatesSubscribe) {
  const byKey = new Map<string, PrStateWire>()
  const versions = new Map<string, number>()
  const consumers = new Set<Consumer>()
  let states: readonly PrStateWire[] = []
  let stopped = false
  let generation = 0
  let failures = 0
  let current: { unsubscribe: () => void } | undefined
  let retry: ReturnType<typeof setTimeout> | undefined

  const close = () => {
    generation += 1
    clearTimeout(retry)
    retry = undefined
    const previous = current
    current = undefined
    previous?.unsubscribe()
  }

  const open = () => {
    if (stopped) return
    generation += 1
    const mine = generation
    const isCurrent = () => !stopped && mine === generation

    const handleEnded = () => {
      if (!isCurrent()) return
      close()
      failures += 1
      retry = setTimeout(open, reconnectDelayMs(failures))
    }

    const handleData = (frame: GithubPrStatesFrame) => {
      if (!isCurrent()) return
      failures = 0
      if (frame.type !== EGithubPrStatesFrame.PrState) return
      const state = prStateWireOfApi(frame.state)
      if (state === undefined) return
      const key = pullRequestKeyOf(state)
      const held = versions.get(key)
      if (held !== undefined && frame.state.version <= held) return
      versions.set(key, frame.state.version)
      byKey.set(key, state)
      states = [...byKey.values()]
      for (const consumer of consumers) consumer.onStates(states)
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
    add: (consumer: Consumer): (() => void) => {
      consumers.add(consumer)
      if (states.length > 0) consumer.onStates(states)
      if (consumers.size === 1) open()
      return () => {
        if (!consumers.delete(consumer)) return
        if (consumers.size > 0) return
        stopped = true
        close()
        sources.delete(subscribe)
      }
    },
  }
}

export function subscribeApiPrStates(args: {
  subscribe: ApiPrStatesSubscribe
  onStates: Consumer['onStates']
}): () => void {
  let source = sources.get(args.subscribe)
  if (source === undefined) {
    source = createSource(args.subscribe)
    sources.set(args.subscribe, source)
  }
  return source.add({ onStates: args.onStates })
}
