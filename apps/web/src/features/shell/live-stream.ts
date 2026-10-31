import { EThreadLiveFrame, type ThreadLiveFrame } from '@dltech/atlas-wire/web'

import {
  reconnectDelayMs,
  timeoutSchedule,
  type Schedule,
} from '@/features/threads/data/thread-signals'

import { applyLiveFrame, emptyLiveList, type LiveListState } from './live-list'

export type LiveListHandlers = {
  onStarted: () => void
  onData: (frame: ThreadLiveFrame) => void
  onError: (failure: unknown) => void
  onComplete: () => void
  onStopped: () => void
  onConnectionStateChange: (state: { state: string; error: unknown }) => void
}

export type SubscribeThreadsLive = (handlers: LiveListHandlers) => { unsubscribe: () => void }

export type AppliedLiveFrame = { state: LiveListState; frame: ThreadLiveFrame; at: number }

export function createThreadsLive(args: {
  subscribe: SubscribeThreadsLive
  onApplied: (applied: AppliedLiveFrame) => void
  schedule?: Schedule
  now?: () => number
}) {
  const schedule = args.schedule ?? timeoutSchedule
  const now = args.now ?? Date.now
  let stopped = false
  let generation = 0
  let failures = 0
  let current: { unsubscribe: () => void } | undefined
  let cancelRetry: (() => void) | undefined
  let state: LiveListState = emptyLiveList()

  const open = () => {
    if (stopped) return
    generation += 1
    const mine = generation
    state = emptyLiveList()
    const isCurrent = () => !stopped && mine === generation
    const drop = () => {
      generation += 1
      current?.unsubscribe()
      current = undefined
      failures += 1
      cancelRetry = schedule({ delayMs: reconnectDelayMs(failures), run: open })
    }
    const handleDrop = () => {
      if (isCurrent()) drop()
    }
    const subscription = args.subscribe({
      onStarted: () => {
        if (!isCurrent()) return
        failures = 0
      },
      onData: (frame) => {
        if (!isCurrent()) return
        if (state.ready === false && frame.type !== EThreadLiveFrame.Snapshot) {
          if (frame.type !== EThreadLiveFrame.Heartbeat) handleDrop()
          return
        }
        const result = applyLiveFrame({ state, frame })
        if (result.resync) {
          drop()
          return
        }
        if (result.state === state) return
        state = result.state
        args.onApplied({ state, frame, at: now() })
      },
      onError: handleDrop,
      onComplete: handleDrop,
      onStopped: handleDrop,
      onConnectionStateChange: (status) => {
        if (status.state === 'connecting' && status.error !== null) handleDrop()
      },
    })
    if (!isCurrent()) {
      subscription.unsubscribe()
      return
    }
    current = subscription
  }

  const reopen = () => {
    current?.unsubscribe()
    current = undefined
    cancelRetry?.()
    cancelRetry = undefined
    failures = 0
    open()
  }

  return {
    start: open,
    reopen,
    stop: () => {
      stopped = true
      cancelRetry?.()
      current?.unsubscribe()
      current = undefined
    },
  }
}
