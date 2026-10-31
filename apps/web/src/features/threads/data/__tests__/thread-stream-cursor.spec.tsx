import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { EThreadStreamFrame, type ThreadStreamFrame } from '@dltech/atlas-wire/web'
import { act } from 'react'

import { cloudThreadBackend } from '../thread-backend'
import { createThreadSignalHub } from '../thread-signal-hub'
import {
  createThreadSignals,
  type SubscribeThreadStream,
  type ThreadStreamHandlers,
} from '../thread-signals'
import { trackedThreadStreamHandlers } from '../thread-stream-adapter'
import { ThreadBackendProvider } from '../use-thread-backend'
import { useThreadSignals } from '../use-thread-signals'
import { event } from './live-thread-fixture'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})
const noop = () => undefined
const handlers = (onData: (frame: ThreadStreamFrame) => void): ThreadStreamHandlers => ({
  onData,
  onStarted: noop,
  onError: noop,
  onComplete: noop,
  onStopped: noop,
  onConnectionStateChange: noop,
})

describe('tracked stream adapter and cursors', () => {
  it('normalizes tracked data to the existing raw handler and reports the delivered cursor', () => {
    const seen: unknown[] = []
    const adapter = trackedThreadStreamHandlers({
      handlers: handlers((frame) => seen.push(frame)),
      onCursor: (cursor) => seen.push(cursor),
    })
    const data = { type: EThreadStreamFrame.Head, head: 3, historyRev: 2 }
    adapter.onData({ id: 'v1:2:3', data })
    expect(seen).toEqual([data, 'v1:2:3'])
  })

  it('retains the cursor across custom retries and drops stale subscription cursor callbacks', () => {
    const opened: Parameters<SubscribeThreadStream>[0][] = []
    const retries: (() => void)[] = []
    const checkpoints: unknown[] = []
    const batches: unknown[] = []
    const resets: unknown[] = []
    const signals = createThreadSignals({
      threadId: 'thr_1',
      subscribe: (args) => {
        opened.push(args)
        return { unsubscribe: noop }
      },
      onHead: noop,
      onPod: noop,
      onTitle: noop,
      onStarted: noop,
      onCheckpoint: (value) => checkpoints.push(value),
      onEvents: (value) => batches.push(value),
      onReset: (value) => resets.push(value),
      schedule: ({ run }) => {
        retries.push(run)
        return noop
      },
    })
    signals.start()
    opened[0]!.onCursor?.('v1:0:2')
    opened[0]!.handlers.onError(new Error('retry'))
    opened[0]!.onCursor?.('v1:0:999')
    retries[0]!()
    expect(opened[1]!.lastEventId).toBe('v1:0:2')
    opened[1]!.handlers.onData({ type: EThreadStreamFrame.Head, head: 2, historyRev: 0 })
    opened[1]!.handlers.onData({
      type: EThreadStreamFrame.Events,
      fromSeq: 3,
      events: [event(3)],
      historyRev: 0,
    })
    opened[1]!.handlers.onData({ type: EThreadStreamFrame.Reset, head: 1, historyRev: 1 })
    expect(checkpoints).toEqual([{ type: EThreadStreamFrame.Head, head: 2, historyRev: 0 }])
    expect(batches).toEqual([
      { type: EThreadStreamFrame.Events, fromSeq: 3, head: 3, events: [event(3)], historyRev: 0 },
    ])
    expect(resets).toEqual([{ type: EThreadStreamFrame.Reset, head: 1, historyRev: 1 }])
    signals.stop()
  })

  it('retains the per-thread cursor through page hiding and never sends it to another thread', async () => {
    const opened: Parameters<SubscribeThreadStream>[0][] = []
    const backend = {
      ...cloudThreadBackend,
      subscribeStream: (args: Parameters<SubscribeThreadStream>[0]) => {
        opened.push(args)
        return { unsubscribe: noop }
      },
    }
    function Probe({ threadId }: { threadId: string }) {
      useThreadSignals(threadId)
      return null
    }
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(document.createElement('div'))
    const render = (threadId: string) =>
      act(async () =>
        root.render(
          <ThreadBackendProvider backend={backend}>
            <Probe threadId={threadId} />
          </ThreadBackendProvider>,
        ),
      )
    const visibility = (value: string) =>
      act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value })
        document.dispatchEvent(new Event('visibilitychange'))
      })
    try {
      await render('thr_1')
      opened[0]!.onCursor?.('v1:4:10')
      await visibility('hidden')
      await visibility('visible')
      expect(opened[1]!.lastEventId).toBe('v1:4:10')
      await render('thr_2')
      expect(opened[2]!.threadId).toBe('thr_2')
      expect(opened[2]!.lastEventId).toBeUndefined()
    } finally {
      await act(async () => root.unmount())
    }
  })

  it('replays the latest epoch checkpoint without replaying append payloads', () => {
    const hub = createThreadSignalHub()
    hub.emitCheckpoint({ head: 2, historyRev: 0 })
    hub.emitReset({ head: 2, historyRev: 1 })
    hub.emitEvents({ head: 3, historyRev: 1, fromSeq: 3, events: [event(3)] })
    hub.emitCheckpoint({ head: 99, historyRev: 0 })
    const checkpoints: unknown[] = []
    const batches: unknown[] = []
    hub.listen({
      onCheckpoint: (value) => checkpoints.push(value),
      onEvents: (value) => batches.push(value),
    })
    expect(checkpoints).toEqual([{ head: 3, historyRev: 1 }])
    expect(batches).toEqual([])
  })
})
