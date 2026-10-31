import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { EServeFrame } from '@dltech/atlas-client/channel'

import { clearCloudCache } from '@/lib/query-client'

import { event, flush } from './live-thread-fixture'
import { TestWebSocket, threadCacheRig } from './thread-cache-fixture'

const realFetch = globalThis.fetch
let socketDescriptor: PropertyDescriptor | undefined
beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  socketDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket')
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: TestWebSocket })
})
afterAll(async () => {
  if (socketDescriptor) Object.defineProperty(globalThis, 'WebSocket', socketDescriptor)
  await GlobalRegistrator.unregister()
})
afterEach(() => {
  clearCloudCache()
  globalThis.fetch = realFetch
  TestWebSocket.sockets = []
})
const settle = () => act(flush)

describe('epoch-aware shared transcript cache', () => {
  it('shares one snapshot seed with websocket and appends Events without another HTTP request', async () => {
    const test = threadCacheRig({ live: true, snapshot: true, deferred: true })
    const mounted = await test.mount()
    try {
      await act(async () => test.hub.emitCheckpoint({ head: 2, historyRev: 0 }))
      await act(async () => test.release())
      await settle()
      expect(test.reads).toEqual([undefined])
      expect(test.calls[0]?.url).toContain('threadEvents.snapshot')
      await act(async () =>
        test.hub.emitEvents({ head: 3, fromSeq: 3, historyRev: 0, events: [event(3)] }),
      )
      await settle()
      expect(test.state().events).toEqual([event(1), event(2), event(3)])
      expect(test.reads).toEqual([undefined])
    } finally {
      await mounted.unmount()
    }
  })

  it('shares a coherent initial seed crossing Reset without a duplicate replacement read', async () => {
    const test = threadCacheRig({ live: true, snapshot: true, deferred: true })
    const mounted = await test.mount()
    try {
      await act(async () => test.hub.emitCheckpoint({ head: 2, historyRev: 0 }))
      test.setEpoch(1)
      test.setLog([event(2)])
      await act(async () => test.hub.emitReset({ head: 2, historyRev: 1 }))
      await act(async () => test.release())
      await settle()
      expect(test.state().events).toEqual([event(2)])
      expect(test.reads).toEqual([undefined])
    } finally {
      await mounted.unmount()
    }
  })

  it('does not reopen an old captured websocket seed after Reset while minting', async () => {
    const test = threadCacheRig({ live: true, snapshot: true, deferredMint: true })
    const mounted = await test.mount()
    const rewritten = { ...event(2), id: 'rewritten' }
    try {
      await settle()
      test.setEpoch(1)
      test.setLog([rewritten])
      await act(async () => test.hub.emitReset({ head: 2, historyRev: 1 }))
      await settle()
      await act(async () => test.releaseMint())
      await settle()
      await act(async () => {
        test.socket().open()
        test.socket().receive({ kind: EServeFrame.Ready, seq: 0 })
      })
      const request = test.socket().requests().at(-1)!
      await act(async () =>
        test.socket().receive({
          kind: EServeFrame.Reply,
          replyTo: request.id,
          ok: true,
          data: { events: [event(3)] },
        }),
      )
      expect(test.state().events).toEqual([rewritten, event(3)])
      expect(test.reads).toEqual([undefined, undefined])
    } finally {
      await mounted.unmount()
    }
  })

  it('reloads same-head Reset once and retains the accepted epoch over hide/resume', async () => {
    const test = threadCacheRig({ snapshot: true })
    const mounted = await test.mount(false)
    const rewritten = { ...event(2), id: 'rewritten' }
    try {
      await settle()
      await act(async () => test.hub.emitCheckpoint({ head: 2, historyRev: 0 }))
      test.setLog([rewritten])
      test.setEpoch(1)
      await act(async () => test.hub.emitReset({ head: 2, historyRev: 1 }))
      await settle()
      await act(async () => test.hub.emitReset({ head: 2, historyRev: 1 }))
      expect(test.state().events).toEqual([rewritten])
      expect(test.reads).toEqual([undefined, undefined])
      await act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await settle()
      expect(test.state().events).toEqual([rewritten])
      expect(test.reads).toEqual([undefined, undefined, 2])
    } finally {
      await mounted.unmount()
    }
  })

  it('invalidates deferred websocket ReadEvents across a newer SSE epoch and preserves fallback', async () => {
    const test = threadCacheRig({ live: true, snapshot: true })
    const mounted = await test.mount()
    const rewritten = { ...event(2), id: 'rewritten' }
    try {
      await settle()
      await act(async () => test.hub.emitCheckpoint({ head: 2, historyRev: 0 }))
      await act(async () => {
        test.socket().open()
        test.socket().receive({ kind: EServeFrame.Ready, seq: 0 })
      })
      const stale = test.socket().requests().at(-1)!
      test.setLog([rewritten])
      test.setEpoch(1)
      await act(async () => test.hub.emitReset({ head: 2, historyRev: 1 }))
      await settle()
      expect(test.state().events).toEqual([rewritten])
      await act(async () =>
        test.socket().receive({
          kind: EServeFrame.Reply,
          replyTo: stale.id,
          ok: true,
          data: { events: [event(2), event(3)] },
        }),
      )
      expect(test.state().events).toEqual([rewritten])
      await act(async () => test.socket().receive({ kind: EServeFrame.Parked, reason: 'idle' }))
      await settle()
      expect(test.state().live).toBe(false)
      expect(test.state().events).toEqual([rewritten])
      expect(test.reads).toEqual([undefined, undefined, 2])
    } finally {
      await mounted.unmount()
    }
  })

  it('catches up a current-epoch append suppressed during an already captured replacement', async () => {
    const captured = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    let holding = false
    const test = threadCacheRig({
      live: true,
      snapshot: true,
      afterSnapshot: async () => {
        if (!holding) return
        captured.resolve()
        await released.promise
      },
    })
    const mounted = await test.mount()
    const rewritten = { ...event(2), id: 'rewritten' }
    try {
      await settle()
      await act(async () => {
        test.socket().open()
        test.socket().receive({ kind: EServeFrame.Ready, seq: 0 })
      })
      const initial = test.socket().requests().at(-1)!
      await act(async () =>
        test.socket().receive({
          kind: EServeFrame.Reply,
          replyTo: initial.id,
          ok: true,
          data: { events: [] },
        }),
      )
      test.setEpoch(1)
      test.setLog([rewritten])
      holding = true
      await act(async () => {
        test.hub.emitReset({ head: 2, historyRev: 1 })
        await captured.promise
      })
      test.setLog([rewritten, event(3)])
      await act(async () => {
        test
          .socket()
          .receive({ kind: EServeFrame.Signal, seq: 1, signal: { type: 'events-appended' } })
        test.hub.emitEvents({ head: 3, fromSeq: 3, historyRev: 1, events: [event(3)] })
      })
      expect(test.socket().requests()).toHaveLength(1)
      await act(async () => {
        holding = false
        released.resolve()
      })
      await settle()
      expect(test.state().live).toBe(true)
      expect(test.state().events).toEqual([rewritten])
      expect(test.socket().requests()).toHaveLength(2)
      const catchup = test.socket().requests().at(-1)!
      expect(catchup.params).toEqual({ threadId: 'thr_1', fromSeq: 2, own: true })
      await act(async () =>
        test.socket().receive({
          kind: EServeFrame.Reply,
          replyTo: catchup.id,
          ok: true,
          data: { events: [event(3)] },
        }),
      )
      expect(test.state().events).toEqual([rewritten, event(3)])
      expect(test.state().live).toBe(true)
      expect(test.reads).toEqual([undefined, undefined])
    } finally {
      released.resolve()
      await mounted.unmount()
    }
  })

  it('replays a missed epoch checkpoint to a re-enabled fallback reader on the same stream', async () => {
    const test = threadCacheRig({ snapshot: true })
    const mounted = await test.mount(false)
    try {
      await settle()
      await act(async () => test.hub.emitCheckpoint({ head: 2, historyRev: 0 }))
      await act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      test.setLog([event(2)])
      test.setEpoch(1)
      await act(async () => test.hub.emitReset({ head: 2, historyRev: 1 }))
      expect(test.reads).toEqual([undefined])
      await act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await settle()
      expect(test.state().events).toEqual([event(2)])
      expect(test.reads.filter((seq) => seq === undefined)).toHaveLength(2)
    } finally {
      await mounted.unmount()
    }
  })
})
