import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, expect, it } from 'bun:test'
import { EThreadStreamFrame, type ThreadStreamFrame } from '@dltech/atlas-wire/web'

import { ELocalActivityState, type LocalThread } from '../local-thread-wire'
import { createLocalThreadFeed } from '../local-thread-feed'
import { localSummary } from './local-thread-fixture'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  Reflect.deleteProperty(window, 'atlasDesktop')
})

it('publishes per-thread activity and reason changes without requiring head, title or pod changes', async () => {
  Reflect.set(window, 'atlasDesktop', {})
  let summary: LocalThread = localSummary
  const calls: string[] = []
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      calls.push(String(input))
      return Response.json({ threads: [summary] })
    },
    { preconnect: realFetch.preconnect },
  )
  let tick: (() => void) | undefined
  let onPolled: (() => void) | undefined
  const feed = createLocalThreadFeed({
    schedule: ({ run }) => {
      tick = run
      onPolled?.()
      return () => {
        tick = undefined
      }
    },
  })
  const poll = async (run: () => void) => {
    const completed = new Promise<void>((resolve) => {
      onPolled = resolve
    })
    run()
    await completed
  }
  const received: LocalThread[] = []
  let stop: () => void = () => undefined
  await poll(() => {
    stop = feed.subscribeMetadata({
      threadId: 'brn_1',
      listener: (thread) => received.push(thread),
    })
  })
  const { status, ...base } = localSummary
  summary = {
    ...base,
    activityState: ELocalActivityState.Unavailable,
    reason: 'Unsupported activity',
  }
  await poll(() => tick?.())
  summary = { ...summary, reason: 'Activity read timed out' }
  await poll(() => tick?.())
  await poll(() => tick?.())
  summary = localSummary
  await poll(() => tick?.())
  expect(received.map((thread) => thread.activityState)).toEqual([
    'available',
    'unavailable',
    'unavailable',
    'available',
  ])
  expect(received[2]).toMatchObject({
    reason: 'Activity read timed out',
    title: 'Host title',
    head: 3,
  })
  expect(calls).toEqual(Array(5).fill('/desktop/threads'))
  stop()
  expect(tick).toBeUndefined()
})

it('does not relabel activity-only changes as title, head, pod or stream-start events', async () => {
  Reflect.set(window, 'atlasDesktop', {})
  let summary: LocalThread = localSummary
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) =>
      Response.json(
        String(input).endsWith('/status') ? { state: 'parked', steps: [] } : { threads: [summary] },
      ),
    { preconnect: realFetch.preconnect },
  )
  let tick: (() => void) | undefined
  let onPolled: (() => void) | undefined
  const feed = createLocalThreadFeed({
    schedule: ({ run }) => {
      tick = run
      onPolled?.()
      return () => {
        tick = undefined
      }
    },
  })
  const completed = () =>
    new Promise<void>((resolve) => {
      onPolled = resolve
    })
  const frames: ThreadStreamFrame[] = []
  let onPod: () => void = () => undefined
  const firstPod = new Promise<void>((resolve) => {
    onPod = resolve
  })
  let starts = 0
  const firstPoll = completed()
  const stream = feed.subscribeStream({
    threadId: 'brn_1',
    handlers: {
      onStarted: () => {
        starts += 1
      },
      onData: (frame) => {
        frames.push(frame)
        if (frame.type === EThreadStreamFrame.Pod) onPod()
      },
      onError: () => undefined,
      onComplete: () => undefined,
      onStopped: () => undefined,
      onConnectionStateChange: () => undefined,
    },
  })
  await firstPoll
  await firstPod
  const received: LocalThread[] = []
  const stop = feed.subscribeMetadata({
    threadId: 'brn_1',
    listener: (thread) => received.push(thread),
  })
  frames.length = 0
  const { status, ...base } = localSummary
  summary = {
    ...base,
    activityState: ELocalActivityState.Unavailable,
    reason: 'Activity unsupported',
  }
  const nextPoll = completed()
  tick?.()
  await nextPoll
  expect(received).toEqual([summary])
  expect(frames).toEqual([])
  expect(starts).toBe(1)
  stop()
  stream.unsubscribe()
})

it('does not start metadata polling in a hosted browser', () => {
  const calls: string[] = []
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      calls.push(String(input))
      throw new Error('Unexpected request')
    },
    { preconnect: realFetch.preconnect },
  )
  const feed = createLocalThreadFeed({
    schedule: () => {
      throw new Error('Unexpected polling')
    },
  })
  const stop = feed.subscribeMetadata({ threadId: 'brn_1', listener: () => undefined })
  expect(calls).toEqual([])
  stop()
})
