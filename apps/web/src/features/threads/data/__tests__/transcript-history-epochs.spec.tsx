import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { clearCloudCache } from '@/lib/query-client'

import type { EventsSnapshot } from '../events-snapshot'
import { createTranscriptHistory } from '../transcript-history'
import { event } from './live-thread-fixture'

beforeAll(() => GlobalRegistrator.register())
afterAll(async () => {
  await GlobalRegistrator.unregister()
})
afterEach(clearCloudCache)
const snapshot = (historyRev: number): EventsSnapshot => ({
  events: [event(1)],
  head: 1,
  historyRev,
})

function rig() {
  const reads: ReturnType<typeof Promise.withResolvers<EventsSnapshot>>[] = []
  const history = createTranscriptHistory({
    threadId: 'thr_1',
    fetchSnapshot: () => {
      const pending = Promise.withResolvers<EventsSnapshot>()
      reads.push(pending)
      return pending.promise
    },
  })
  return { history, reads }
}

describe('transcript cache history identity', () => {
  it('shares one descriptor request with the array-returning websocket seed', async () => {
    const test = rig()
    const polling = test.history.readSnapshot()
    const live = test.history.readSeed()
    expect(test.reads).toHaveLength(1)
    test.reads[0]!.resolve(snapshot(0))
    expect(await polling).toEqual(snapshot(0))
    expect(await live).toEqual([event(1)])
    expect(test.history.descriptor()).toEqual(snapshot(0))
  })

  it('does not label cached epoch0 rows epoch1 before replacement completes', async () => {
    const test = rig()
    test.history.replaceSnapshot(snapshot(0))
    test.history.expectEpoch({ head: 1, historyRev: 0 })
    test.history.expectEpoch({ head: 1, historyRev: 1 })
    const replacement = test.history.readSnapshot()
    const websocket = test.history.readSeed()
    expect(test.history.descriptor()).toEqual(snapshot(0))
    expect(test.reads).toHaveLength(1)
    const fresh = { ...snapshot(1), events: [] }
    test.reads[0]!.resolve(fresh)
    expect(await replacement).toEqual(fresh)
    expect(await websocket).toEqual([])
    expect(test.history.descriptor()).toEqual(fresh)
  })

  it('rejects a captured epoch0 seed after the first Head1, without leaking it to websocket', async () => {
    const test = rig()
    const polling = test.history.readSnapshot()
    const live = test.history.readSeed()
    test.history.expectEpoch({ head: 1, historyRev: 1 })
    test.reads[0]!.resolve(snapshot(0))
    await Promise.resolve()
    await Promise.resolve()
    expect(test.history.snapshot()).toBeUndefined()
    expect(test.reads).toHaveLength(2)
    const fresh = { ...snapshot(1), events: [] }
    test.reads[1]!.resolve(fresh)
    expect(await polling).toEqual(fresh)
    expect(await live).toEqual([])
  })

  it('invalidates websocket readers when an accepted HTTP snapshot discovers a newer epoch', async () => {
    const test = rig()
    test.history.replaceSnapshot(snapshot(0))
    let invalidations = 0
    const unlisten = test.history.onEpochChange(() => {
      invalidations += 1
    })
    test.history.replaceSnapshot(snapshot(1))
    expect(invalidations).toBe(1)
    expect(await test.history.readSeed()).toEqual([event(1)])
    expect(test.reads).toEqual([])
    unlisten()
  })

  it('prevents a pending cached seed from overwriting accepted Events or Reset rows', async () => {
    const test = rig()
    const pending = test.history.readSeed()
    test.history.expectEpoch({ head: 1, historyRev: 1 })
    const fresh = { ...snapshot(1), events: [event(2)], head: 2 }
    test.history.replaceSnapshot(fresh)
    test.reads[0]!.resolve(snapshot(0))
    expect(await pending).toEqual([event(2)])
    expect(test.history.descriptor()).toEqual(fresh)
    expect(test.reads).toHaveLength(1)
  })
})
