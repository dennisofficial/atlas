import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, expect, it } from 'bun:test'
import { act } from 'react'
import { EThreadStreamFrame, type ThreadStreamFrame } from '@dltech/atlas-wire/web'

import type { ThreadStreamHandlers } from '@/features/threads/data/thread-signals'

import { createLocalThreadFeed } from '../local-thread-feed'
import { localSummary } from './local-thread-fixture'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => GlobalRegistrator.unregister())
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  Reflect.deleteProperty(window, 'atlasDesktop')
})

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

it('discards a late resource result across unsubscribe/resubscribe without overlapping reads for that thread', async () => {
  Reflect.set(window, 'atlasDesktop', {})
  let release: () => void = () => undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let statusReads = 0
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      if (String(input) === '/desktop/threads') return Response.json({ threads: [localSummary] })
      statusReads += 1
      await pending
      return Response.json({ state: 'parked', steps: [] })
    },
    { preconnect: realFetch.preconnect },
  )
  let tick: (() => void) | undefined
  const feed = createLocalThreadFeed({
    schedule: ({ run }) => {
      tick = run
      return () => {
        tick = undefined
      }
    },
  })
  const oldFrames: ThreadStreamFrame[] = []
  const newFrames: ThreadStreamFrame[] = []
  let oldStream: ReturnType<typeof feed.subscribeStream> | undefined
  let newStream: ReturnType<typeof feed.subscribeStream> | undefined
  try {
    await act(async () => {
      oldStream = feed.subscribeStream({ threadId: 'brn_1', handlers: handlersOf(oldFrames) })
    })
    expect(statusReads).toBe(1)
    oldFrames.length = 0
    oldStream?.unsubscribe()
    await act(async () => {
      newStream = feed.subscribeStream({ threadId: 'brn_1', handlers: handlersOf(newFrames) })
    })
    expect(statusReads).toBe(1)
    newFrames.length = 0
    await act(async () => {
      release()
      await pending
    })
    expect(oldFrames).toEqual([])
    expect(newFrames).toEqual([])
    await act(async () => tick?.())
    expect(statusReads).toBe(2)
    expect(newFrames).toEqual([
      { type: EThreadStreamFrame.Pod, status: { state: 'parked', steps: [] } },
    ])
  } finally {
    oldStream?.unsubscribe()
    newStream?.unsubscribe()
    release()
    await pending
  }
})
