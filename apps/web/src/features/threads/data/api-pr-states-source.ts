import {
  EGithubPrStatesFrame,
  type GithubPrStatesFrame,
  type PrStateWire,
} from '@dltech/atlas-wire/web'

import type { PrObservationStatus } from './pr-observation-status'
import {
  prObservationKeyOf,
  selectPrObservationTargets,
  type PrObservation,
  type PrObservationTarget,
} from './pr-observation-targets'
import { prStateWireOfApi } from './pr-states-merge'
import { pullRequestKeyOf } from './pull-request-entries'
import { RECONNECT_BASE_MS, reconnectDelayMs } from './thread-signals'

export type ApiPrStatesSubscribe = (handlers: {
  observe?: readonly PrObservationTarget[]
  onData: (frame: GithubPrStatesFrame) => void
  onError: (failure: unknown) => void
  onComplete: () => void
}) => { unsubscribe: () => void }

type Consumer = {
  observe: readonly PrObservation[]
  onStates: (states: readonly PrStateWire[]) => void
  onObservationStatus?: (status: PrObservationStatus | null) => void
}

export type ApiPrStatesSubscription = (() => void) & {
  setObservations: (observe: readonly PrObservation[]) => void
}

const OBSERVATION_RETRY_MS = 45000
const sources = new WeakMap<ApiPrStatesSubscribe, ReturnType<typeof createSource>>()
const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

function createSource(subscribe: ApiPrStatesSubscribe) {
  const byKey = new Map<string, PrStateWire>()
  const consumers = new Set<Consumer>()
  let states: readonly PrStateWire[] = []
  let targets: readonly PrObservationTarget[] = []
  let status: PrObservationStatus | null = null
  let stopped = false
  let generation = 0
  let failures = 0
  let current: { unsubscribe: () => void } | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let observationRetry: ReturnType<typeof setTimeout> | undefined

  const publishStatus = (next: PrObservationStatus | null) => {
    status = next
    for (const consumer of consumers) consumer.onObservationStatus?.(status)
  }

  const close = () => {
    generation += 1
    clearTimeout(retry)
    clearTimeout(observationRetry)
    observationRetry = undefined
    const previous = current
    current = undefined
    previous?.unsubscribe()
  }

  const restart = () => {
    close()
    open()
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
      const retryAfterMs = reconnectDelayMs(failures)
      if (targets.length > 0) {
        publishStatus({
          type: EGithubPrStatesFrame.ObservationStatus,
          available: false,
          message: 'Live pull request checks are disconnected. Cached checks may be stale.',
          retryAfterMs,
        })
      }
      retry = setTimeout(open, retryAfterMs)
    }

    const handleData = (frame: GithubPrStatesFrame) => {
      if (!isCurrent()) return
      failures = 0
      if (frame.type === EGithubPrStatesFrame.ObservationStatus) {
        if (targets.length === 0) return
        publishStatus(frame)
        if (frame.available) {
          clearTimeout(observationRetry)
          observationRetry = undefined
        } else if (observationRetry === undefined) {
          observationRetry = setTimeout(
            () => {
              if (isCurrent()) restart()
            },
            Math.max(RECONNECT_BASE_MS, frame.retryAfterMs ?? OBSERVATION_RETRY_MS),
          )
        }
        return
      }
      if (frame.type !== EGithubPrStatesFrame.PrState) return
      const state = prStateWireOfApi(frame.state)
      if (state === undefined) return
      byKey.set(pullRequestKeyOf(state), state)
      states = [...byKey.values()]
      for (const consumer of consumers) consumer.onStates(states)
    }

    try {
      const subscription = subscribe({
        ...(targets.length > 0 ? { observe: targets } : {}),
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

  const syncObservations = () => {
    const next = visible()
      ? selectPrObservationTargets([...consumers].flatMap((consumer) => consumer.observe))
      : []
    if (prObservationKeyOf(next) === prObservationKeyOf(targets)) return
    targets = next
    if (targets.length === 0) publishStatus(null)
    restart()
  }

  return {
    add: (consumer: Consumer): ApiPrStatesSubscription => {
      consumers.add(consumer)
      if (states.length > 0) consumer.onStates(states)
      consumer.onObservationStatus?.(status)
      if (consumers.size === 1) {
        targets = visible() ? selectPrObservationTargets(consumer.observe) : []
        if (typeof document !== 'undefined')
          document.addEventListener('visibilitychange', syncObservations)
        open()
      } else syncObservations()
      const stop = () => {
        if (!consumers.delete(consumer)) return
        if (consumers.size > 0) {
          syncObservations()
          return
        }
        consumer.onObservationStatus?.(null)
        stopped = true
        close()
        if (typeof document !== 'undefined')
          document.removeEventListener('visibilitychange', syncObservations)
        sources.delete(subscribe)
      }
      return Object.assign(stop, {
        setObservations: (observe: readonly PrObservation[]) => {
          if (!consumers.has(consumer)) return
          consumer.observe = observe
          syncObservations()
        },
      })
    },
  }
}

export function subscribeApiPrStates(args: {
  subscribe: ApiPrStatesSubscribe
  observe?: readonly PrObservation[]
  onStates: Consumer['onStates']
  onObservationStatus?: Consumer['onObservationStatus']
}): ApiPrStatesSubscription {
  let source = sources.get(args.subscribe)
  if (source === undefined) {
    source = createSource(args.subscribe)
    sources.set(args.subscribe, source)
  }
  return source.add({ ...args, observe: args.observe ?? [] })
}
