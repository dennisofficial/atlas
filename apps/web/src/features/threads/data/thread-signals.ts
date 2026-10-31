import { EThreadStreamFrame, type ThreadStreamFrame } from '@dltech/atlas-wire/web'

import type { ThreadMetadata, ThreadPodSignal } from './thread-signal-hub'
import type { EventsBatch, EventsCheckpoint } from './events-snapshot'
import { headOf } from './live-events'

export const RECONNECT_BASE_MS = 1000
export const RECONNECT_CEILING_MS = 30000
export const HEALTHY_LIFETIME_MS = 5000

export const reconnectDelayMs = (failures: number): number =>
  Math.min(RECONNECT_CEILING_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, failures - 1))

export type Schedule = (task: { delayMs: number; run: () => void }) => () => void

export const timeoutSchedule: Schedule = ({ delayMs, run }) => {
  const timer = setTimeout(run, delayMs)
  return () => clearTimeout(timer)
}

export type ThreadStreamHandlers = {
  onStarted: () => void
  onData: (frame: ThreadStreamFrame) => void
  onError: (failure: unknown) => void
  onComplete: () => void
  onStopped: () => void
  onConnectionStateChange: (state: { state: string; error: unknown }) => void
}

export type SubscribeThreadStream = (args: {
  threadId: string
  handlers: ThreadStreamHandlers
  lastEventId?: string | undefined
  onCursor?: ((cursor: string) => void) | undefined
}) => { unsubscribe: () => void }

export function createThreadSignals(args: {
  threadId: string
  subscribe: SubscribeThreadStream
  onHead: (head: number) => void
  onCheckpoint?: (checkpoint: EventsCheckpoint) => void
  onEvents?: (batch: EventsBatch) => void
  onReset?: (checkpoint: EventsCheckpoint) => void
  lastEventId?: string | undefined
  onCursor?: (cursor: string) => void
  onPod: (payload: ThreadPodSignal) => void
  onMeta?: (metadata: ThreadMetadata) => void
  onTitle: () => void
  onStarted: () => void
  schedule?: Schedule
  now?: () => number
}) {
  const schedule = args.schedule ?? timeoutSchedule
  const now = args.now ?? Date.now
  let lastEventId = args.lastEventId
  let stopped = false
  let generation = 0
  let failures = 0
  let current: { unsubscribe: () => void } | undefined
  let cancelRetry: (() => void) | undefined

  const open = () => {
    if (stopped) return
    generation += 1
    const mine = generation
    const openedAt = now()
    let framed = false
    const isCurrent = () => !stopped && mine === generation

    const drop = (delayMs: number) => {
      generation += 1
      current?.unsubscribe()
      current = undefined
      cancelRetry = schedule({ delayMs, run: open })
    }

    const settleHealthy = (): boolean => {
      const healthy = framed && now() - openedAt >= HEALTHY_LIFETIME_MS
      if (healthy) failures = 0
      return healthy
    }

    const handleFailure = () => {
      if (!isCurrent()) return
      settleHealthy()
      failures += 1
      drop(reconnectDelayMs(failures))
    }

    const handleEnd = () => {
      if (!isCurrent()) return
      if (settleHealthy()) drop(0)
      else handleFailure()
    }

    const handleData = (frame: ThreadStreamFrame) => {
      if (!isCurrent()) return
      framed = true
      if (frame.type === EThreadStreamFrame.Head) {
        if (args.onCheckpoint) args.onCheckpoint(frame)
        else args.onHead(frame.head)
      }
      if (frame.type === EThreadStreamFrame.Events)
        args.onEvents?.({
          ...frame,
          head: Math.max(headOf(frame.events), frame.fromSeq),
        })
      if (frame.type === EThreadStreamFrame.Reset) args.onReset?.(frame)
      if (frame.type === EThreadStreamFrame.Pod)
        args.onPod({ status: frame.status, rev: frame.rev })
      if (frame.type === EThreadStreamFrame.Meta)
        args.onMeta?.({ thread: frame.thread, rev: frame.rev })
      if (frame.type === EThreadStreamFrame.Title) args.onTitle()
    }

    const handleStarted = () => {
      if (!isCurrent()) return
      args.onStarted()
    }

    const subscription = args.subscribe({
      threadId: args.threadId,
      lastEventId,
      onCursor: (cursor) => {
        if (!isCurrent()) return
        lastEventId = cursor
        args.onCursor?.(cursor)
      },
      handlers: {
        onStarted: handleStarted,
        onData: handleData,
        onError: handleFailure,
        onComplete: handleEnd,
        onStopped: handleEnd,
        onConnectionStateChange: (state) => {
          if (state.state === 'connecting' && state.error !== null) handleFailure()
        },
      },
    })
    if (!isCurrent()) {
      subscription.unsubscribe()
      return
    }
    current = subscription
  }

  return {
    start: open,
    stop: () => {
      stopped = true
      cancelRetry?.()
      current?.unsubscribe()
      current = undefined
    },
  }
}
