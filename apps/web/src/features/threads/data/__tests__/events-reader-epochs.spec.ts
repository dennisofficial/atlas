import { describe, expect, it } from 'bun:test'

import { createEventsReader, INITIAL_THREAD_EVENTS, type ThreadEvents } from '../events-reader'
import type { EventsSnapshot } from '../events-snapshot'
import { event } from './live-thread-fixture'

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const snapshot = (args: {
  historyRev?: number
  head?: number
  seqs?: number[]
}): EventsSnapshot => ({
  events: (args.seqs ?? [1]).map((seq) => event(seq)),
  head: args.head ?? 1,
  historyRev: args.historyRev ?? 0,
})

function rig() {
  let state: ThreadEvents = INITIAL_THREAD_EVENTS
  const seed = Promise.withResolvers<EventsSnapshot>()
  const reads: {
    fromSeq: number | undefined
    result: ReturnType<typeof Promise.withResolvers<EventsSnapshot>>
  }[] = []
  const updates: ThreadEvents[] = []
  const reader = createEventsReader({
    threadId: 'thr_1',
    fetchSeed: () => seed.promise,
    fetchEvents: async () => {
      throw new Error('untagged cloud read')
    },
    fetchSnapshot: ({ fromSeq }) => {
      const result = Promise.withResolvers<EventsSnapshot>()
      reads.push({ fromSeq, result })
      return result.promise
    },
    onUpdate: (update) => {
      state = update(state)
      updates.push(state)
    },
  })
  return { reader, seed, reads, updates, state: () => state }
}

describe('ordered event reader', () => {
  it('appends small Events and deduplicates without any HTTP reads after the seed', async () => {
    const test = rig()
    test.reader.start()
    test.seed.resolve(snapshot({}))
    await flush()
    const batch = { head: 2, fromSeq: 2, historyRev: 0, events: [event(2)] }
    test.reader.handleEvents(batch)
    test.reader.handleEvents(batch)
    test.reader.handleCheckpoint({ head: 2, historyRev: 0 })
    await flush()
    expect(test.state().events).toEqual([event(1), event(2)])
    expect(test.reads).toEqual([])
    test.reader.stop()
  })

  it('does not attach an untagged payload to accepted epoch rows', async () => {
    const test = rig()
    test.reader.start()
    test.seed.resolve(snapshot({ historyRev: 1 }))
    await flush()
    test.reader.handleEvents({ head: 2, fromSeq: 2, events: [{ ...event(2), id: 'unverified' }] })
    expect(test.state().events).toEqual([event(1)])
    expect(test.reads.map((read) => read.fromSeq)).toEqual([1])
    test.reads[0]!.result.resolve(snapshot({ historyRev: 1, head: 2, seqs: [1, 2] }))
    await flush()
    expect(test.state().events).toEqual([event(1), event(2)])
    test.reader.stop()
  })

  it('buffers append during the initial seed without a second download', async () => {
    const test = rig()
    test.reader.start()
    test.reader.handleEvents({ head: 2, fromSeq: 2, historyRev: 0, events: [event(2)] })
    test.seed.resolve(snapshot({}))
    await flush()
    expect(test.state().events).toEqual([event(1), event(2)])
    expect(test.reads).toEqual([])
    test.reader.stop()
  })

  it('rejects a seed captured in epoch0 when the first observed Head is epoch1 without Reset', async () => {
    const test = rig()
    test.reader.start()
    test.reader.handleCheckpoint({ head: 1, historyRev: 1 })
    test.seed.resolve(snapshot({ historyRev: 0 }))
    await flush()
    expect(test.updates).toEqual([])
    expect(test.reads.map((read) => read.fromSeq)).toEqual([undefined])
    test.reads[0]!.result.resolve({ ...snapshot({ historyRev: 1 }), events: [] })
    await flush()
    expect(test.state().events).toEqual([])
    test.reader.stop()
  })

  it('replaces same-head history once and rejects stale payloads after Reset', async () => {
    const test = rig()
    test.reader.start()
    test.seed.resolve(snapshot({ head: 2, seqs: [1, 2] }))
    await flush()
    test.reader.handleReset({ head: 2, historyRev: 1 })
    test.reader.handleReset({ head: 2, historyRev: 1 })
    test.reader.handleEvents({ head: 3, fromSeq: 3, historyRev: 0, events: [event(3)] })
    test.reader.handleEvents({ head: 3, fromSeq: 3, historyRev: 1, events: [event(3)] })
    test.reads[0]!.result.resolve(snapshot({ historyRev: 1, head: 2, seqs: [2] }))
    await flush()
    expect(test.state().events).toEqual([event(2), event(3)])
    expect(test.reads).toHaveLength(1)
    test.reader.stop()
  })

  it('drops a pending delta and a pending replacement crossing newer epochs', async () => {
    const test = rig()
    test.reader.start()
    test.seed.resolve(snapshot({}))
    await flush()
    test.reader.poke()
    test.reader.handleReset({ head: 1, historyRev: 1 })
    test.reads[0]!.result.resolve(snapshot({ head: 2, seqs: [1, 2] }))
    await flush()
    test.reader.handleReset({ head: 1, historyRev: 2 })
    test.reads[1]!.result.resolve(snapshot({ historyRev: 1, seqs: [1] }))
    await flush()
    expect(test.updates).toHaveLength(1)
    test.reads[2]!.result.resolve(snapshot({ historyRev: 2, seqs: [] }))
    await flush()
    expect(test.state().events).toEqual([])
    test.reader.stop()
  })

  it('does not lower the accepted floor when an older delta finishes after inline Events', async () => {
    const test = rig()
    test.reader.start()
    test.seed.resolve(snapshot({}))
    await flush()
    test.reader.poke()
    test.reader.handleEvents({ head: 3, fromSeq: 2, historyRev: 0, events: [event(2), event(3)] })
    test.reads[0]!.result.resolve(snapshot({ head: 2, seqs: [1, 2] }))
    await flush()
    test.reader.handleEvents({ head: 4, fromSeq: 4, historyRev: 0, events: [event(4)] })
    expect(test.state().events).toEqual([event(1), event(2), event(3), event(4)])
    expect(test.reads).toHaveLength(1)
    test.reader.stop()
  })

  it('uses the logical snapshot floor for empty reference history', async () => {
    const test = rig()
    test.reader.start()
    test.reader.handleCheckpoint({ head: 8, historyRev: 0 })
    test.seed.resolve(snapshot({ head: 8, seqs: [] }))
    await flush()
    test.reader.handleEvents({ head: 9, fromSeq: 9, historyRev: 0, events: [event(9)] })
    expect(test.state().events).toEqual([event(9)])
    expect(test.reads).toEqual([])
    test.reader.stop()
  })

  it('recovers a suffix gap with an inclusive bounded snapshot', async () => {
    const test = rig()
    test.reader.start()
    test.seed.resolve(snapshot({ head: 8, seqs: [3, 8] }))
    await flush()
    test.reader.handleEvents({ head: 10, fromSeq: 10, historyRev: 0, events: [event(10)] })
    expect(test.reads.map((read) => read.fromSeq)).toEqual([8])
    test.reads[0]!.result.resolve(snapshot({ head: 10, seqs: [8, 9, 10] }))
    await flush()
    expect(test.state().events).toEqual([event(3), event(8), event(9), event(10)])
    test.reader.stop()
  })
})
