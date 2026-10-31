import { describe, expect, it } from 'bun:test'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { createEventsReader, INITIAL_THREAD_EVENTS, type ThreadEvents } from '../events-reader'

const event = (seq: number): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'thr_local',
  seq,
  runId: 'run_local',
  depth: 0,
  at: '2026-10-31T10:00:00.000Z',
  type: 'user-said',
  body: '{}',
})
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('local stored history reader', () => {
  it('accepts sparse sequence ranges without a duplicate full-history read', async () => {
    const reads: (number | undefined)[] = []
    let state: ThreadEvents = INITIAL_THREAD_EVENTS
    const reader = createEventsReader({
      threadId: 'thr_local',
      localCopy: true,
      fetchSeed: async () => [event(1)],
      fetchEvents: async ({ fromSeq }) => {
        reads.push(fromSeq)
        return [event(1), event(4)]
      },
      onUpdate: (update) => (state = update(state)),
    })
    reader.start()
    await flush()
    reader.handleHead(4)
    await flush()
    await flush()
    expect(reads).toHaveLength(1)
    expect(reads).toEqual([1])
    expect(state.events.map((row) => row.seq)).toEqual([1, 4])
    reader.stop()
  })

  it('replaces sparse history when a delta omits its stored anchor', async () => {
    const reads: (number | undefined)[] = []
    let state: ThreadEvents = INITIAL_THREAD_EVENTS
    const reader = createEventsReader({
      threadId: 'thr_local',
      localCopy: true,
      fetchSeed: async () => [event(1), event(4)],
      fetchEvents: async ({ fromSeq }) => {
        reads.push(fromSeq)
        return fromSeq === undefined ? [event(1), event(7)] : [event(7)]
      },
      onUpdate: (update) => (state = update(state)),
    })
    reader.start()
    await flush()
    reader.handleHead(7)
    await flush()
    expect(reads).toEqual([4, undefined])
    expect(state.events.map((row) => row.seq)).toEqual([1, 7])
    reader.stop()
  })

  it('resets a seed ahead of the first observed host head', async () => {
    let state: ThreadEvents = INITIAL_THREAD_EVENTS
    const reader = createEventsReader({
      threadId: 'thr_local',
      localCopy: true,
      fetchSeed: async () => [event(1), event(2), event(3)],
      fetchEvents: async ({ fromSeq }) => (fromSeq === undefined ? [event(1)] : []),
      onUpdate: (update) => (state = update(state)),
    })
    reader.start()
    await flush()
    reader.handleHead(1)
    await flush()
    expect(state.events.map((row) => row.seq)).toEqual([1])
    reader.stop()
  })

  it('retries a failed history reset without retaining a stale prefix', async () => {
    let state: ThreadEvents = INITIAL_THREAD_EVENTS
    let failing = true
    const reader = createEventsReader({
      threadId: 'thr_local',
      localCopy: true,
      fetchSeed: async () => [event(1), event(2), event(3)],
      fetchEvents: async ({ fromSeq }) => {
        if (fromSeq !== undefined) return []
        if (failing) throw new Error('host unavailable')
        return [{ ...event(1), id: 'evt_rewritten' }]
      },
      onUpdate: (update) => (state = update(state)),
    })
    reader.handleHead(3)
    await flush()
    reader.handleHead(1)
    await flush()
    expect(state.error?.message).toBe('host unavailable')
    failing = false
    reader.handleHead(1)
    await flush()
    expect(state.events.map((row) => row.id)).toEqual(['evt_rewritten'])
    expect(state.error).toBeNull()
    reader.stop()
  })

  it('replaces rewritten history when the host head shrinks', async () => {
    const reads: (number | undefined)[] = []
    let state: ThreadEvents = INITIAL_THREAD_EVENTS
    const reader = createEventsReader({
      threadId: 'thr_local',
      localCopy: true,
      fetchSeed: async () => [event(1), event(2), event(3)],
      fetchEvents: async ({ fromSeq }) => {
        reads.push(fromSeq)
        return [{ ...event(1), id: 'evt_rewritten' }]
      },
      onUpdate: (update) => (state = update(state)),
    })
    reader.handleHead(3)
    await flush()
    reader.handleHead(1)
    await flush()
    expect(reads).toEqual([undefined])
    expect(state.events.map((row) => row.id)).toEqual(['evt_rewritten'])
    reader.stop()
  })
})
