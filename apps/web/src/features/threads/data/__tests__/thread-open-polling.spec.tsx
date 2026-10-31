import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { EClientRequest, EServeFrame } from '@dltech/atlas-client/channel'

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

const settle = () =>
  act(async () => {
    await flush()
  })
const ready = async (args: { test: ReturnType<typeof threadCacheRig>; answer?: boolean }) => {
  const { test } = args
  await act(async () => {
    test.socket().open()
    test.socket().receive({ kind: EServeFrame.Ready, seq: 0 })
  })
  if (args.answer === false) return
  const request = test.socket().requests().at(-1)!
  expect(request.op).toBe(EClientRequest.ReadEvents)
  expect(request.params).toEqual({ threadId: 'thr_1', fromSeq: 2, own: true })
  await act(async () =>
    test.socket().receive({
      kind: EServeFrame.Reply,
      replyTo: request.id,
      ok: true,
      data: { events: [] },
    }),
  )
}

describe('opening a running thread through the real transcript cache', () => {
  it('shares one in-flight full HTTP read between live and polling, then reads deltas', async () => {
    const test = threadCacheRig({ deferred: true })
    const mounted = await test.mount()
    try {
      expect(test.reads).toEqual([])
      await act(async () => {
        test.release()
      })
      await settle()
      expect(test.reads).toEqual([undefined])
      expect(test.state().events).toEqual([event(1), event(2)])
      test.setLog([event(1), event(2), event(3)])
      await act(async () => test.hub.emitHead(3))
      await settle()
      expect(test.reads).toEqual([undefined, 2])
      expect(test.state().events).toEqual([event(1), event(2), event(3)])
    } finally {
      await mounted.unmount()
    }
  })

  it('does one full recovery read when a delta cannot reach the announced head', async () => {
    const test = threadCacheRig()
    const mounted = await test.mount()
    try {
      await settle()
      await act(async () => test.hub.emitHead(9))
      await settle()
      expect(test.reads).toEqual([undefined, 2, undefined])
    } finally {
      await mounted.unmount()
    }
  })

  it('recovers a cloud shortening on fallback without an SSE head', async () => {
    const test = threadCacheRig({ live: true })
    const mounted = await test.mount()
    try {
      await settle()
      await ready({ test })
      test.setLog([event(1)])
      await act(async () => test.socket().receive({ kind: EServeFrame.Parked, reason: 'idle' }))
      await settle()
      expect(test.state().events).toEqual([event(1)])
      expect(test.reads).toEqual([undefined, 2, undefined])
      test.setLog([])
      await act(async () => test.state().refreshEvents())
      await settle()
      expect(test.state().events).toEqual([])
      expect(test.reads).toEqual([undefined, 2, undefined, 1, undefined])
    } finally {
      await mounted.unmount()
    }
  })

  it('reopens with fresh shortened or replaced history, not the previous open snapshot', async () => {
    const test = threadCacheRig()
    const first = await test.mount()
    await settle()
    await first.unmount()
    test.setLog([event(1)])
    const second = await test.mount()
    await settle()
    expect(test.state().events).toEqual([event(1)])
    await second.unmount()
    const replacement = { ...event(1), id: 'new-branch' }
    test.setLog([replacement])
    const third = await test.mount()
    try {
      await settle()
      expect(test.state().events).toEqual([replacement])
      expect(test.reads).toEqual([undefined, undefined, undefined])
    } finally {
      await third.unmount()
    }
  })

  it('reconciles a hidden page with a delta on reactivation without another SSE head', async () => {
    const test = threadCacheRig()
    const mounted = await test.mount()
    try {
      await settle()
      await act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      test.setLog([event(1), event(2), event(3)])
      await act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await settle()
      expect(test.state().events).toEqual([event(1), event(2), event(3)])
      expect(test.reads).toEqual([undefined, 2])
    } finally {
      await mounted.unmount()
    }
  })
})
