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

function rig(options?: {
  fail?: () => boolean
  history?: (fromSeq: number | undefined, generation: number) => WireEvent[]
}) {
  let state: ThreadEvents = INITIAL_THREAD_EVENTS
  const calls: { seeds: number; reads: { fromSeq: number | undefined }[] } = {
    seeds: 0,
    reads: [],
  }
  const reader = createEventsReader({
    threadId: 'thr_1',
    fetchSeed: async () => {
      calls.seeds += 1
      if (options?.fail?.() === true) throw new Error('offline')
      return [event(1)]
    },
    fetchEvents: async ({ fromSeq }) => {
      const read = { fromSeq: fromSeq ?? undefined }
      calls.reads.push(read)
      const generation = calls.reads.length
      const history = options?.history?.(read.fromSeq, generation) ?? [
        event(1),
        event(2),
        event(3),
        event(4),
      ]
      return fromSeq === undefined ? history : history.filter((item) => item.seq >= fromSeq)
    },
    onUpdate: (update) => {
      state = update(state)
    },
  })
  return { reader, calls, state: () => state }
}

describe('createEventsReader', () => {
  it('seeds from the history promise on start and not again without a signal', async () => {
    const test = rig()
    test.reader.start()
    await flush()
    await flush()
    expect(test.calls.seeds).toBe(1)
    expect(test.calls.reads).toEqual([])
    expect(test.state().loaded).toBe(true)
  })

  it('reads again only when a head frame carries a head it has not read', async () => {
    const test = rig()
    test.reader.handleHead(3)
    await flush()
    await flush()
    expect(test.calls.seeds).toBe(1)
    expect(test.calls.reads).toEqual([{ fromSeq: 1 }])

    test.reader.handleHead(3)
    await flush()
    expect(test.calls.reads).toEqual([{ fromSeq: 1 }])

    test.reader.handleHead(4)
    await flush()
    expect(test.calls.reads).toEqual([{ fromSeq: 1 }, { fromSeq: 4 }])
  })

  it('coalesces signals that arrive while a read is in flight into one more read', async () => {
    const test = rig()
    test.reader.start()
    test.reader.poke()
    test.reader.handleHead(2)
    test.reader.handleHead(3)
    await flush()
    await flush()
    await flush()
    expect(test.calls.seeds).toBe(1)
    expect(test.calls.reads.length).toBeLessThanOrEqual(2)
  })

  it('appends a delta read after the seeded head instead of re-reading the full log', async () => {
    const test = rig({
      history: (fromSeq) =>
        fromSeq === 1 ? [event(1), event(2), event(3)] : [event(1), event(2), event(3)],
    })
    test.reader.start()
    await flush()
    test.reader.handleHead(3)
    await flush()
    expect(test.calls.reads).toEqual([{ fromSeq: 1 }])
    expect(test.state().events.map((item) => item.seq)).toEqual([1, 2, 3])
  })

  it('falls back to a full read when the delta leaves a gap to the announced head', async () => {
    const test = rig({
      history: (fromSeq) => (fromSeq === undefined ? [event(1), event(2), event(3)] : []),
    })
    test.reader.start()
    await flush()
    test.reader.handleHead(3)
    await flush()
    expect(test.calls.reads).toEqual([{ fromSeq: 1 }, { fromSeq: undefined }])
    expect(test.state().events.map((item) => item.seq)).toEqual([1, 2, 3])
  })

  it('falls back to a full read when the delta is not contiguous', async () => {
    const test = rig({
      history: (fromSeq) => (fromSeq === undefined ? [event(1), event(2)] : [event(1), event(3)]),
    })
    test.reader.start()
    await flush()
    test.reader.handleHead(3)
    await flush()
    expect(test.calls.reads).toEqual([{ fromSeq: 1 }, { fromSeq: undefined }])
    expect(test.state().events.map((item) => item.seq)).toEqual([1, 2])
  })

  it('falls back to a full read when the anchor event changed id', async () => {
    const test = rig({
      history: (fromSeq) => {
        if (fromSeq === undefined) return [event(1), event(2)]
        return [{ ...event(1), id: 'evt_rewritten' }, event(2)]
      },
    })
    test.reader.start()
    await flush()
    test.reader.handleHead(2)
    await flush()
    expect(test.calls.reads).toEqual([{ fromSeq: 1 }, { fromSeq: undefined }])
    expect(test.state().events.map((item) => item.id)).toEqual(['evt_1', 'evt_2'])
  })

  it('trims held events when the announced head rewinds below the read head', async () => {
    const test = rig({
      history: (fromSeq) => (fromSeq === undefined ? [event(1)] : [event(1), event(2), event(3)]),
    })
    test.reader.start()
    await flush()
    test.reader.handleHead(3)
    await flush()
    expect(test.state().events.map((item) => item.seq)).toEqual([1, 2, 3])

    test.reader.handleHead(1)
    await flush()
    expect(test.state().events.map((item) => item.seq)).toEqual([1])
    expect(test.calls.reads).toEqual([{ fromSeq: 1 }])
  })

  it('surfaces a failed seed and retries it on the next frame with the same head', async () => {
    let failing = true
    const test = rig({ fail: () => failing })
    test.reader.handleHead(5)
    await flush()
    expect(test.state().error?.message).toBe('offline')
    expect(test.state().loaded).toBe(false)

    failing = false
    test.reader.handleHead(5)
    await flush()
    expect(test.state()).toMatchObject({ loaded: true, error: null })
    expect(test.calls.seeds).toBe(2)
  })

  it('does nothing after stop', async () => {
    const test = rig()
    test.reader.stop()
    test.reader.start()
    test.reader.poke()
    test.reader.handleHead(9)
    await flush()
    expect(test.calls.seeds).toBe(0)
    expect(test.calls.reads).toEqual([])
  })

  it('drops the result of a read that finishes after stop', async () => {
    const test = rig()
    test.reader.start()
    test.reader.stop()
    await flush()
    expect(test.state()).toBe(INITIAL_THREAD_EVENTS)
  })
})
