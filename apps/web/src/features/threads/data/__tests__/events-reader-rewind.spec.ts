import { describe, expect, it } from 'bun:test'

import type { WireEvent } from '@dltech/atlas-wire/web'

import { createEventsReader, INITIAL_THREAD_EVENTS, type ThreadEvents } from '../events-reader'

const event = (seq: number): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'thr_1',
  seq,
  runId: 'run_1',
  depth: 0,
  at: '2026-10-22T10:00:00.000Z',
  type: 'user-said',
  body: '{}',
})

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function rig() {
  let state: ThreadEvents = INITIAL_THREAD_EVENTS
  const updates: ThreadEvents[] = []
  const seeds: ReturnType<typeof Promise.withResolvers<WireEvent[]>>[] = []
  const reads: {
    fromSeq: number | undefined
    result: ReturnType<typeof Promise.withResolvers<WireEvent[]>>
  }[] = []
  const reader = createEventsReader({
    threadId: 'thr_1',
    fetchSeed: () => {
      const result = Promise.withResolvers<WireEvent[]>()
      seeds.push(result)
      return result.promise
    },
    fetchEvents: ({ fromSeq }) => {
      const result = Promise.withResolvers<WireEvent[]>()
      reads.push({ fromSeq, result })
      return result.promise
    },
    onUpdate: (update) => {
      state = update(state)
      updates.push(state)
    },
  })
  return { reader, seeds, reads, updates, state: () => state }
}

describe('createEventsReader rewind reconciliation', () => {
  it('reads a head again after 3 → 1 → 3', async () => {
    const test = rig()
    test.reader.handleHead(3)
    test.seeds[0]!.resolve([event(1), event(2), event(3)])
    await flush()

    test.reader.handleHead(1)
    expect(test.reads.map((read) => read.fromSeq)).toStrictEqual([undefined])
    test.reads[0]!.result.resolve([event(1)])
    await flush()
    expect(test.state().events).toEqual([event(1)])

    test.reader.handleHead(3)
    expect(test.reads.map((read) => read.fromSeq)).toStrictEqual([undefined, 1])
    test.reads[1]!.result.resolve([event(1), event(2), event(3)])
    await flush()
    expect(test.state().events).toEqual([event(1), event(2), event(3)])
    test.reader.stop()
  })

  it('discards a seed that finishes after a rewind and queues a fresh full read', async () => {
    const test = rig()
    test.reader.handleHead(3)
    test.reader.handleHead(1)
    test.seeds[0]!.resolve([event(1), event(2), event(3)])
    await flush()

    expect(test.updates).toEqual([])
    expect(test.seeds).toHaveLength(1)
    expect(test.reads.map((read) => read.fromSeq)).toStrictEqual([undefined])
    test.reads[0]!.result.resolve([event(1)])
    await flush()
    expect(test.state().events).toEqual([event(1)])
    test.reader.stop()
  })

  it('discards a delta that finishes after a rewind', async () => {
    const test = rig()
    test.reader.handleHead(1)
    test.seeds[0]!.resolve([event(1)])
    await flush()
    test.reader.handleHead(3)
    test.reader.handleHead(1)
    test.reads[0]!.result.resolve([event(1), event(2), event(3)])
    await flush()

    expect(test.updates).toHaveLength(1)
    expect(test.reads.map((read) => read.fromSeq)).toStrictEqual([1, undefined])
    test.reads[1]!.result.resolve([event(1)])
    await flush()
    expect(test.state().events).toEqual([event(1)])
    test.reader.stop()
  })

  it('discards a gap fallback that finishes after a rewind', async () => {
    const test = rig()
    test.reader.handleHead(1)
    test.seeds[0]!.resolve([event(1)])
    await flush()
    test.reader.handleHead(3)
    test.reads[0]!.result.resolve([])
    await flush()
    expect(test.reads.map((read) => read.fromSeq)).toStrictEqual([1, undefined])

    test.reader.handleHead(1)
    test.reads[1]!.result.resolve([event(1), event(2), event(3)])
    await flush()
    expect(test.updates).toHaveLength(1)
    expect(test.reads.map((read) => read.fromSeq)).toStrictEqual([1, undefined, undefined])
    test.reads[2]!.result.resolve([event(1)])
    await flush()
    expect(test.state().events).toEqual([event(1)])
    test.reader.stop()
  })

  it('reconciles a cached seed newer than the authoritative first head', async () => {
    const test = rig()
    test.reader.handleHead(1)
    test.seeds[0]!.resolve([event(1), event(2), event(3)])
    await flush()

    expect(test.updates).toEqual([])
    expect(test.reads.map((read) => read.fromSeq)).toStrictEqual([undefined])
    const rewritten = { ...event(1), id: 'evt_rewritten' }
    test.reads[0]!.result.resolve([rewritten])
    await flush()
    expect(test.state().events).toEqual([rewritten])
    test.reader.stop()
  })

  it('reconciles a head received while the shared initial seed is pending', async () => {
    const test = rig()
    test.reader.start()
    test.reader.handleHead(1)
    test.seeds[0]!.resolve([event(1), event(2), event(3)])
    await flush()

    expect(test.updates).toEqual([])
    expect(test.seeds).toHaveLength(1)
    expect(test.reads.map((read) => read.fromSeq)).toStrictEqual([undefined])
    test.reads[0]!.result.resolve([event(1)])
    await flush()
    expect(test.state().events).toEqual([event(1)])
    test.reader.stop()
  })

  it('rejects a pre-rewind delta even if the head returns to the same sequence', async () => {
    const test = rig()
    test.reader.handleHead(1)
    test.seeds[0]!.resolve([event(1)])
    await flush()
    test.reader.handleHead(3)
    test.reader.handleHead(1)
    test.reader.handleHead(3)
    test.reads[0]!.result.resolve([event(1), event(2), event(3)])
    await flush()

    expect(test.updates).toHaveLength(1)
    expect(test.reads.map((read) => read.fromSeq)).toStrictEqual([1, undefined])
    const rewritten = { ...event(3), id: 'evt_rewritten' }
    test.reads[1]!.result.resolve([event(1), event(2), rewritten])
    await flush()
    expect(test.state().events).toEqual([event(1), event(2), rewritten])
    test.reader.stop()
  })

  it('discards an earlier rewind full read when another rewind supersedes it', async () => {
    const test = rig()
    test.reader.handleHead(3)
    test.seeds[0]!.resolve([event(1), event(2), event(3)])
    await flush()
    test.reader.handleHead(2)
    test.reader.handleHead(0)
    test.reads[0]!.result.resolve([event(1), event(2)])
    await flush()

    expect(test.updates).toHaveLength(1)
    expect(test.reads.map((read) => read.fromSeq)).toStrictEqual([undefined, undefined])
    test.reads[1]!.result.resolve([])
    await flush()
    expect(test.state().events).toEqual([])
    test.reader.stop()
  })

  it('ignores superseded failures and retries a failed rewind as a full read', async () => {
    const test = rig()
    test.reader.handleHead(1)
    test.seeds[0]!.resolve([event(1)])
    await flush()
    test.reader.handleHead(3)
    test.reader.handleHead(1)
    test.reads[0]!.result.reject(new Error('superseded'))
    await flush()
    expect(test.state().error).toBeNull()

    test.reads[1]!.result.reject(new Error('offline'))
    await flush()
    expect(test.state().error?.message).toBe('offline')
    test.reader.handleHead(1)
    expect(test.reads.map((read) => read.fromSeq)).toStrictEqual([1, undefined, undefined])
    test.reads[2]!.result.resolve([event(1)])
    await flush()
    expect(test.state()).toMatchObject({ events: [event(1)], error: null })
    test.reader.stop()
  })
})
