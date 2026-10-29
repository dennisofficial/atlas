import { EThreadListFrame, type ThreadListFrame } from '@dltech/atlas-wire/web'
import {
  reconnectDelayMs,
  timeoutSchedule,
  type Schedule,
} from '@/features/threads/data/thread-signals'

export const LIST_RELOAD_DEBOUNCE_MS = 300

export function createListReloader(args: { reload: () => void; schedule?: Schedule }) {
  const schedule = args.schedule ?? timeoutSchedule
  let cancel: (() => void) | undefined
  const fire = () => {
    cancel = undefined
    args.reload()
  }
  return {
    handleFrame: () => {
      if (cancel !== undefined) return
      cancel = schedule({ delayMs: LIST_RELOAD_DEBOUNCE_MS, run: fire })
    },
    handleReconnect: () => {
      cancel?.()
      fire()
    },
    stop: () => {
      cancel?.()
      cancel = undefined
    },
  }
}

export type ListSignalHandlers = {
  onStarted: () => void
  onData: (frame: ThreadListFrame) => void
  onError: (failure: unknown) => void
  onComplete: () => void
  onStopped: () => void
  onConnectionStateChange: (state: { state: string; error: unknown }) => void
}

export type SubscribeListSignals = (handlers: ListSignalHandlers) => { unsubscribe: () => void }

export function createListSignals(args: {
  subscribe: SubscribeListSignals
  reload: () => void
  schedule?: Schedule
}) {
  const schedule = args.schedule ?? timeoutSchedule
  const reloader = createListReloader({ reload: args.reload, schedule })
  let stopped = false
  let generation = 0
  let failures = 0
  let opened = 0
  let current: { unsubscribe: () => void } | undefined
  let cancelRetry: (() => void) | undefined

  const open = () => {
    if (stopped) return
    generation += 1
    const mine = generation
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
        opened += 1
        if (opened > 1) reloader.handleReconnect()
      },
      onData: (frame) => {
        if (isCurrent() && frame.type === EThreadListFrame.Changed) reloader.handleFrame()
      },
      onError: handleDrop,
      onComplete: handleDrop,
      onStopped: handleDrop,
      onConnectionStateChange: (state) => {
        if (state.state === 'connecting' && state.error !== null) handleDrop()
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
      reloader.stop()
      current?.unsubscribe()
      current = undefined
    },
  }
}
