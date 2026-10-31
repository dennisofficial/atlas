import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { clearCloudCache, sharedQueryClient } from '@/lib/query-client'

import { createTranscriptHistory, transcriptEventsKey } from '../transcript-history'
import { event } from './live-thread-fixture'
import { fakeFetch, trpcOk } from './trpc-fake'

const realFetch = globalThis.fetch

beforeAll(() => GlobalRegistrator.register())
afterAll(async () => {
  await GlobalRegistrator.unregister()
})
afterEach(() => {
  clearCloudCache()
  globalThis.fetch = realFetch
})

describe('per-open transcript cache', () => {
  it('shares a loaded full read and replaces it with current progress, including a rewind', async () => {
    const calls = fakeFetch(() => trpcOk([event(1), event(2)]))
    const history = createTranscriptHistory({ threadId: 'thr_1' })

    expect(await history.readSeed()).toEqual([event(1), event(2)])
    expect(await history.readSeed()).toEqual([event(1), event(2)])
    history.replace([event(1), event(2), event(3)])
    expect(await history.readSeed()).toEqual([event(1), event(2), event(3)])
    history.replace([event(1)])
    expect(await history.readSeed()).toEqual([event(1)])
    expect(history.snapshot()).toEqual([event(1)])
    expect(calls).toHaveLength(1)
  })

  it('retains the shared query while open so the seed cannot be garbage-collected mid-session', async () => {
    const calls = fakeFetch(() => trpcOk([event(1)]))
    const history = createTranscriptHistory({ threadId: 'thr_1' })
    const releasePolling = history.retain()
    const releaseLive = history.retain()
    try {
      await history.readSeed()
      const query = sharedQueryClient()
        .getQueryCache()
        .findAll({
          queryKey: transcriptEventsKey('thr_1'),
        })[0]!
      expect(query.getObserversCount()).toBe(2)
      releasePolling()
      expect(query.getObserversCount()).toBe(1)
      releaseLive()
      expect(query.getObserversCount()).toBe(0)
      expect(calls).toHaveLength(1)
    } finally {
      releasePolling()
      releaseLive()
    }
  })

  it('deduplicates concurrent full reads before the history has loaded', async () => {
    let finish: ((events: WireEvent[]) => void) | undefined
    let fullReads = 0
    const pending = new Promise<WireEvent[]>((resolve) => {
      finish = resolve
    })
    const history = createTranscriptHistory({
      threadId: 'thr_1',
      fetchSeed: () => {
        fullReads += 1
        return pending
      },
    })
    const polling = history.readSeed()
    const live = history.readSeed()
    expect(fullReads).toBe(1)
    expect(history.snapshot()).toBeUndefined()
    finish?.([event(1)])
    expect(await polling).toEqual([event(1)])
    expect(await live).toEqual([event(1)])
    expect(fullReads).toBe(1)
  })

  it('starts a fresh full read on every open, including same-head replacement after rewind', async () => {
    let stored = [event(1), event(2)]
    const calls = fakeFetch(() => trpcOk(stored))
    const first = createTranscriptHistory({ threadId: 'thr_1' })
    await first.readSeed()
    stored = [event(1), { ...event(2), id: 'replacement', body: '{"fresh":true}' }]
    const second = createTranscriptHistory({ threadId: 'thr_1' })
    expect(await second.readSeed()).toEqual(stored)
    stored = [event(1)]
    const third = createTranscriptHistory({ threadId: 'thr_1' })
    expect(await third.readSeed()).toEqual(stored)
    expect(calls).toHaveLength(3)
    expect(first.snapshot()).toEqual([event(1), event(2)])
  })
})
