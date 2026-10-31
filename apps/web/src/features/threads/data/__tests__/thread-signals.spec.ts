import { describe, expect, it } from 'bun:test'

import { EPodState, EThreadStreamFrame } from '@dltech/atlas-wire/web'

import type { ThreadMetadata, ThreadPodSignal } from '../thread-signal-hub'

import {
  createThreadSignals,
  HEALTHY_LIFETIME_MS,
  reconnectDelayMs,
  type ThreadStreamHandlers,
} from '../thread-signals'

function rig() {
  const subscriptions: { handlers: ThreadStreamHandlers; unsubscribed: boolean }[] = []
  const tasks: { delayMs: number; run: () => void; cancelled: boolean }[] = []
  const seen = { heads: [] as number[], pods: 0, titles: 0, starts: 0 }
  const metadata: ThreadMetadata[] = []
  const statuses: ThreadPodSignal[] = []
  let clock = 0
  const signals = createThreadSignals({
    threadId: 'thr_1',
    subscribe: ({ handlers }) => {
      const entry = { handlers, unsubscribed: false }
      subscriptions.push(entry)
      return {
        unsubscribe: () => {
          entry.unsubscribed = true
        },
      }
    },
    onHead: (head) => seen.heads.push(head),
    onPod: (payload) => {
      seen.pods += 1
      statuses.push(payload)
    },
    onMeta: (frame) => metadata.push(frame),
    onTitle: () => {
      seen.titles += 1
    },
    onStarted: () => {
      seen.starts += 1
    },
    schedule: (task) => {
      const entry = { ...task, cancelled: false }
      tasks.push(entry)
      return () => {
        entry.cancelled = true
      }
    },
    now: () => clock,
  })
  return {
    signals,
    subscriptions,
    tasks,
    seen,
    metadata,
    statuses,
    advance: (ms: number) => {
      clock += ms
    },
    latest: () => subscriptions.at(-1),
  }
}

describe('reconnectDelayMs', () => {
  it('doubles from one second up to a thirty second ceiling', () => {
    expect([1, 2, 3, 6, 7, 20].map(reconnectDelayMs)).toEqual([
      1000, 2000, 4000, 30000, 30000, 30000,
    ])
  })
})

describe('createThreadSignals', () => {
  it('forwards start, head and pod frames and ignores heartbeats', () => {
    const test = rig()
    test.signals.start()
    const handlers = test.latest()?.handlers
    handlers?.onStarted()
    handlers?.onData({ type: EThreadStreamFrame.Head, head: 4 })
    handlers?.onData({ type: EThreadStreamFrame.Heartbeat })
    handlers?.onData({ type: EThreadStreamFrame.Pod })
    handlers?.onData({ type: EThreadStreamFrame.Title })

    expect(test.seen).toEqual({ heads: [4], pods: 1, titles: 1, starts: 1 })
  })

  it('propagates metadata and Pod payloads while ignoring superseded and stopped frames', () => {
    const test = rig()
    test.signals.start()
    const handlers = test.latest()?.handlers
    const metadata = {
      thread: {
        id: 'thr_1',
        head: 0,
        workspace: null,
        repo: null,
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
      },
      rev: 4,
    }
    const frame = { type: EThreadStreamFrame.Meta, ...metadata }
    const status = { state: EPodState.Running, steps: [] }
    handlers?.onData(frame)
    handlers?.onData({ type: EThreadStreamFrame.Pod, status, rev: 6 })
    handlers?.onData({ type: EThreadStreamFrame.Pod, status })
    handlers?.onData({ type: EThreadStreamFrame.Pod })
    expect(test.metadata).toEqual([metadata])
    expect(test.statuses).toEqual([
      { status, rev: 6 },
      { status, rev: undefined },
      { status: undefined, rev: undefined },
    ])
    handlers?.onError(new Error('offline'))
    handlers?.onData(frame)
    handlers?.onData({ type: EThreadStreamFrame.Pod, status })
    test.tasks.at(-1)?.run()
    test.signals.stop()
    test.latest()?.handlers.onData(frame)
    test.latest()?.handlers.onData({ type: EThreadStreamFrame.Pod, status })
    expect(test.metadata).toEqual([metadata])
    expect(test.statuses).toEqual([
      { status, rev: 6 },
      { status, rev: undefined },
      { status: undefined, rev: undefined },
    ])
  })

  it('resubscribes at once when a healthy stream completes', () => {
    const test = rig()
    test.signals.start()
    test.latest()?.handlers.onData({ type: EThreadStreamFrame.Head, head: 1 })
    test.advance(HEALTHY_LIFETIME_MS)
    test.latest()?.handlers.onComplete()

    expect(test.subscriptions[0]?.unsubscribed).toBe(true)
    expect(test.tasks.map((task) => task.delayMs)).toEqual([0])
    test.tasks[0]?.run()
    expect(test.subscriptions).toHaveLength(2)
  })

  it('backs off on errors and resets after a stream that lived a normal lifetime', () => {
    const test = rig()
    test.signals.start()
    test.latest()?.handlers.onError(new Error('down'))
    test.tasks.at(-1)?.run()
    test.latest()?.handlers.onError(new Error('down'))
    test.tasks.at(-1)?.run()
    test.latest()?.handlers.onError(new Error('down'))
    expect(test.tasks.map((task) => task.delayMs)).toEqual([1000, 2000, 4000])

    test.tasks.at(-1)?.run()
    test.latest()?.handlers.onData({ type: EThreadStreamFrame.Head, head: 1 })
    test.advance(HEALTHY_LIFETIME_MS)
    test.latest()?.handlers.onComplete()
    test.tasks.at(-1)?.run()
    test.latest()?.handlers.onError(new Error('down'))
    expect(test.tasks.map((task) => task.delayMs)).toEqual([1000, 2000, 4000, 0, 1000])
  })

  it('treats a stream that ends before any frame as a failure, not an instant retry loop', () => {
    const test = rig()
    test.signals.start()
    test.latest()?.handlers.onComplete()
    test.tasks.at(-1)?.run()
    test.latest()?.handlers.onStopped()
    expect(test.tasks.map((task) => task.delayMs)).toEqual([1000, 2000])
  })

  it('treats a reconnecting state carrying an error as a failure and drops that subscription', () => {
    const test = rig()
    test.signals.start()
    test.latest()?.handlers.onConnectionStateChange({ state: 'connecting', error: null })
    expect(test.tasks).toHaveLength(0)
    test.latest()?.handlers.onConnectionStateChange({ state: 'connecting', error: new Error('x') })
    expect(test.subscriptions[0]?.unsubscribed).toBe(true)
    expect(test.tasks.map((task) => task.delayMs)).toEqual([1000])
  })

  it('ignores callbacks from a dropped subscription', () => {
    const test = rig()
    test.signals.start()
    const first = test.latest()?.handlers
    first?.onError(new Error('down'))
    first?.onData({ type: EThreadStreamFrame.Head, head: 9 })
    first?.onError(new Error('again'))

    expect(test.seen.heads).toEqual([])
    expect(test.tasks).toHaveLength(1)
  })

  it('stops for good: unsubscribes, cancels a pending retry and never resubscribes', () => {
    const test = rig()
    test.signals.start()
    test.latest()?.handlers.onError(new Error('down'))
    const retry = test.tasks.at(-1)
    test.signals.stop()
    retry?.run()

    expect(retry?.cancelled).toBe(true)
    expect(test.subscriptions).toHaveLength(1)

    const live = rig()
    live.signals.start()
    live.signals.stop()
    expect(live.subscriptions[0]?.unsubscribed).toBe(true)
  })
})
