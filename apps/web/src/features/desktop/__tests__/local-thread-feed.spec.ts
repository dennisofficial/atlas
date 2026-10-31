import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'bun:test'

import { EThreadStreamFrame, type ThreadStreamFrame } from '@dltech/atlas-wire/web'
import type { ThreadStreamHandlers } from '@/features/threads/data/thread-signals'

import { createLocalThreadFeed } from '../local-thread-feed'
import { localSummary } from './local-thread-fixture'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())
const realFetch = globalThis.fetch
let calls: string[]
let summary: typeof localSummary
let unavailable: boolean
let block: Promise<void> | undefined
let timers: Set<() => void>
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const makeFeed = () =>
  createLocalThreadFeed({
    schedule: ({ run }) => {
      timers.add(run)
      return () => {
        timers.delete(run)
      }
    },
  })
const tick = () => {
  const tasks = [...timers]
  timers.clear()
  for (const run of tasks) run()
}
const handlersOf = (frames: ThreadStreamFrame[]): ThreadStreamHandlers => ({
  onStarted: () => undefined,
  onData: (frame) => {
    frames.push(frame)
  },
  onError: () => undefined,
  onComplete: () => undefined,
  onStopped: () => undefined,
  onConnectionStateChange: () => undefined,
})

beforeEach(() => {
  calls = []
  timers = new Set()
  summary = structuredClone(localSummary)
  unavailable = false
  block = undefined
  Reflect.set(window, 'atlasDesktop', {})
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const path = String(input)
      calls.push(path)
      await block
      if (unavailable) return Response.json({ message: 'Unavailable' }, { status: 503 })
      return Response.json(
        path.endsWith('/status') ? { state: 'parked', steps: [] } : { threads: [summary] },
      )
    },
    { preconnect: realFetch.preconnect },
  )
})
afterEach(() => {
  globalThis.fetch = realFetch
  Reflect.deleteProperty(window, 'atlasDesktop')
})

it('shares passive polling between shell and thread subscriptions and emits host title changes', async () => {
  const feed = makeFeed()
  let changes = 0
  const stopList = feed.subscribeChanges(() => {
    changes += 1
  })
  const frames: ThreadStreamFrame[] = []
  const stream = feed.subscribeStream({ threadId: 'brn_1', handlers: handlersOf(frames) })
  await flush()
  tick()
  await flush()
  frames.length = 0
  const before = changes
  summary = { ...summary, title: 'User rename', head: 4 }
  tick()
  await flush()
  expect(changes).toBe(before + 1)
  expect(frames).toContainEqual({ type: EThreadStreamFrame.Title })
  expect(frames).toContainEqual({ type: EThreadStreamFrame.Head, head: 4 })
  expect(calls.every((path) => path === '/desktop/threads' || path.endsWith('/status'))).toBe(true)
  stream.unsubscribe()
  stopList()
  expect(timers.size).toBe(0)
})

it('never overlaps polls or delivers late callbacks after the last subscriber leaves', async () => {
  let release: () => void = () => undefined
  block = new Promise<void>((resolve) => {
    release = resolve
  })
  const feed = makeFeed()
  const frames: ThreadStreamFrame[] = []
  let started = 0
  let changes = 0
  const stream = feed.subscribeStream({
    threadId: 'brn_1',
    handlers: {
      ...handlersOf(frames),
      onStarted: () => {
        started += 1
      },
    },
  })
  const stop = feed.subscribeChanges(() => {
    changes += 1
  })
  tick()
  await flush()
  expect(calls).toEqual(['/desktop/threads'])
  stream.unsubscribe()
  stop()
  release()
  await flush()
  expect(frames).toEqual([])
  expect(started).toBe(0)
  expect(changes).toBe(0)
  expect(timers.size).toBe(0)
  expect(calls).toEqual(['/desktop/threads'])
})

it('does not revive an unsubscribed callback when the same listener subscribes again', async () => {
  let release: () => void = () => undefined
  block = new Promise<void>((resolve) => {
    release = resolve
  })
  const feed = makeFeed()
  let changes = 0
  const listener = () => {
    changes += 1
  }
  const stop = feed.subscribeChanges(listener)
  stop()
  const stopAgain = feed.subscribeChanges(listener)
  release()
  await flush()
  expect(changes).toBe(0)
  tick()
  await flush()
  expect(changes).toBe(1)
  stopAgain()
})

it('waits for all passive status requests to settle before scheduling another poll', async () => {
  const feed = makeFeed()
  const first = feed.subscribeStream({ threadId: 'brn_1', handlers: handlersOf([]) })
  const second = feed.subscribeStream({ threadId: 'brn_2', handlers: handlersOf([]) })
  await flush()
  tick()
  await flush()
  let release: () => void = () => undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const path = String(input)
      calls.push(path)
      if (path === '/desktop/threads') return Response.json({ threads: [summary] })
      if (path.includes('brn_1')) return Response.json({ message: 'Unavailable' }, { status: 503 })
      await pending
      return Response.json({ state: 'parked', steps: [] })
    },
    { preconnect: realFetch.preconnect },
  )
  tick()
  await flush()
  expect(timers.size).toBe(0)
  release()
  await flush()
  expect(timers.size).toBe(1)
  first.unsubscribe()
  second.unsubscribe()
})

it('refreshes shell subscribers after recovery even when summaries did not change', async () => {
  const feed = makeFeed()
  let changes = 0
  const stop = feed.subscribeChanges(() => {
    changes += 1
  })
  await flush()
  unavailable = true
  tick()
  await flush()
  expect(changes).toBe(2)
  unavailable = false
  tick()
  await flush()
  expect(changes).toBe(3)
  stop()
})

it('reports unavailable host failures instead of an empty successful stream', async () => {
  unavailable = true
  const failures: unknown[] = []
  const feed = makeFeed()
  const stream = feed.subscribeStream({
    threadId: 'brn_1',
    handlers: {
      ...handlersOf([]),
      onError: (failure) => {
        failures.push(failure)
      },
    },
  })
  await flush()
  expect(failures).toHaveLength(1)
  expect(failures[0]).toMatchObject({ status: 503 })
  stream.unsubscribe()
})

it('does not start a polling feed in a hosted browser', async () => {
  Reflect.deleteProperty(window, 'atlasDesktop')
  const feed = makeFeed()
  const stream = feed.subscribeStream({ threadId: 'brn_1', handlers: handlersOf([]) })
  const stop = feed.subscribeChanges(() => undefined)
  await flush()
  expect(calls).toEqual([])
  expect(timers.size).toBe(0)
  stream.unsubscribe()
  stop()
})
