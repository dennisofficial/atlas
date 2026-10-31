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

describe('successful live attachment through the real transcript cache', () => {
  it('retains live progress and reconciles unseen progress on fallback without an SSE head', async () => {
    const test = threadCacheRig({ live: true })
    const mounted = await test.mount()
    try {
      await settle()
      await ready({ test })
      expect(test.state().live).toBe(true)
      expect(test.reads).toEqual([undefined])
      await act(async () =>
        test.socket().receive({
          kind: EServeFrame.Signal,
          seq: 1,
          signal: { type: 'events-appended' },
        }),
      )
      const request = test.socket().requests().at(-1)!
      expect(request.op).toBe(EClientRequest.ReadEvents)
      expect(request.params).toEqual({ threadId: 'thr_1', fromSeq: 2, own: true })
      await act(async () =>
        test.socket().receive({
          kind: EServeFrame.Reply,
          replyTo: request.id,
          ok: true,
          data: { events: [event(3)] },
        }),
      )
      expect(test.state().events).toEqual([event(1), event(2), event(3)])
      test.setLog([event(1), event(2), event(3), event(4)])
      const beforeFallback = test.renders.length
      await act(async () => test.socket().receive({ kind: EServeFrame.Parked, reason: 'idle' }))
      await settle()
      expect(test.state().live).toBe(false)
      expect(test.state().events).toEqual([event(1), event(2), event(3), event(4)])
      expect(test.reads).toEqual([undefined, 3])
      const fallback = test.renders.slice(beforeFallback).filter((view) => !view.live)
      expect(fallback.length).toBeGreaterThan(0)
      expect(fallback.every((view) => view.events.some((entry) => entry.seq === 3))).toBe(true)
    } finally {
      await mounted.unmount()
    }
  })

  it('does not overwrite polling progress while the initial live handshake is pending', async () => {
    const test = threadCacheRig({ live: true })
    const mounted = await test.mount()
    try {
      await settle()
      test.setLog([event(1), event(2), event(3)])
      await act(async () => test.hub.emitHead(3))
      await settle()
      expect(test.state().events).toEqual([event(1), event(2), event(3)])
      const beforeReady = test.renders.length
      await ready({ test, answer: false })
      const request = test.socket().requests().at(-1)!
      expect(test.state().events).toEqual([event(1), event(2), event(3)])
      await act(async () =>
        test.socket().receive({
          kind: EServeFrame.Reply,
          replyTo: request.id,
          ok: true,
          data: { events: [event(3)] },
        }),
      )
      expect(test.renders.slice(beforeReady).every((view) => view.events.length === 3)).toBe(true)
      expect(test.reads).toEqual([undefined, 2])
    } finally {
      await mounted.unmount()
    }
  })

  it('carries a live rewind into polling fallback rather than resurrecting the original tail', async () => {
    const test = threadCacheRig({ live: true })
    const mounted = await test.mount()
    try {
      await settle()
      await ready({ test })
      await act(async () => test.socket().receive({ kind: EServeFrame.Reload, sinceEventSeq: 1 }))
      const request = test.socket().requests().at(-1)!
      expect(request.params).toEqual({ threadId: 'thr_1', fromSeq: 1, own: true })
      const replacement = { ...event(2), id: 'after-rewind' }
      await act(async () =>
        test.socket().receive({
          kind: EServeFrame.Reply,
          replyTo: request.id,
          ok: true,
          data: { events: [replacement] },
        }),
      )
      test.setLog([event(1), replacement])
      await act(async () => test.socket().receive({ kind: EServeFrame.Parked, reason: 'idle' }))
      await settle()
      expect(test.state().events).toEqual([event(1), replacement])
      expect(test.reads).toEqual([undefined, 2])
    } finally {
      await mounted.unmount()
    }
  })

  it('shares a loaded polling seed on live reactivation and catches up with a serve delta', async () => {
    const test = threadCacheRig({ live: true })
    const mounted = await test.mount(false)
    try {
      await settle()
      test.setLog([event(1), event(2), event(3)])
      await mounted.render(true)
      await settle()
      await ready({ test, answer: false })
      const request = test.socket().requests().at(-1)!
      expect(request.params).toEqual({ threadId: 'thr_1', fromSeq: 2, own: true })
      await act(async () =>
        test.socket().receive({
          kind: EServeFrame.Reply,
          replyTo: request.id,
          ok: true,
          data: { events: [event(3)] },
        }),
      )
      expect(test.state().live).toBe(true)
      expect(test.state().events).toEqual([event(1), event(2), event(3)])
      expect(test.reads).toEqual([undefined])
    } finally {
      await mounted.unmount()
    }
  })

  it('keeps the Mac REST seed empty and catches up through serve on connection', async () => {
    const test = threadCacheRig({ live: true, local: true })
    const mounted = await test.mount()
    try {
      await settle()
      await ready({ test, answer: false })
      const request = test.socket().requests().at(-1)!
      expect(request.params).toEqual({ threadId: 'thr_1', fromSeq: 0, own: true })
      await act(async () =>
        test.socket().receive({
          kind: EServeFrame.Reply,
          replyTo: request.id,
          ok: true,
          data: { events: [event(1), event(2)] },
        }),
      )
      expect(test.state().live).toBe(true)
      expect(test.state().events).toEqual([event(1), event(2)])
      await act(async () => test.socket().receive({ kind: EServeFrame.Parked, reason: 'idle' }))
      await settle()
      expect(test.state().events).toEqual([event(1), event(2)])
      await act(async () => test.state().refreshEvents())
      await settle()
      expect(test.state().events).toEqual([event(1), event(2)])
      expect(test.reads).toEqual([])
      expect(test.calls).toHaveLength(0)
    } finally {
      await mounted.unmount()
    }
  })

  it.each([false, true])(
    'discards pre-reload catch-up replies and errors (failed=%s)',
    async (failed) => {
      const test = threadCacheRig({ live: true })
      const mounted = await test.mount()
      try {
        await settle()
        await ready({ test, answer: false })
        const stale = test.socket().requests().at(-1)!
        expect(stale.params).toEqual({ threadId: 'thr_1', fromSeq: 2, own: true })
        await act(async () => test.socket().receive({ kind: EServeFrame.Reload, sinceEventSeq: 0 }))
        expect(test.state().events).toEqual([])
        await act(async () =>
          test.socket().receive({
            kind: EServeFrame.Reply,
            replyTo: stale.id,
            ok: !failed,
            data: failed ? 'superseded read failed' : { events: [event(2), event(3)] },
          }),
        )
        const current = test.socket().requests().at(-1)!
        expect(current.id).not.toBe(stale.id)
        expect(current.params).toEqual({ threadId: 'thr_1', fromSeq: 0, own: true })
        expect(test.state().live).toBe(true)
        expect(test.state().events).toEqual([])
        await act(async () =>
          test.socket().receive({
            kind: EServeFrame.Reply,
            replyTo: current.id,
            ok: true,
            data: { events: [] },
          }),
        )
        expect(test.state().events).toEqual([])
        expect(test.reads).toEqual([undefined])
      } finally {
        await mounted.unmount()
      }
    },
  )
})
