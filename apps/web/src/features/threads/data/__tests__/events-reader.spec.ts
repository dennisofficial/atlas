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

function rig(options?: { fail?: () => boolean }) {
  let state: ThreadEvents = INITIAL_THREAD_EVENTS
  const calls = { events: 0 }
  const reader = createEventsReader({
    threadId: 'thr_1',
    fetchEvents: async () => {
      calls.events += 1
      if (options?.fail?.() === true) throw new Error('offline')
      return [event(calls.events)]
    },
    onUpdate: (update) => {
      state = update(state)
    },
  })
  return { reader, calls, state: () => state }
}

describe('createEventsReader', () => {
  it('reads on start and not again without a signal', async () => {
    const test = rig()
    test.reader.start()
    await flush()
    await flush()
    expect(test.calls.events).toBe(1)
    expect(test.state().loaded).toBe(true)
  })

  it('reads again only when a head frame carries a head it has not read', async () => {
    const test = rig()
    test.reader.handleHead(3)
    await flush()
    expect(test.calls.events).toBe(1)

    test.reader.handleHead(3)
    await flush()
    expect(test.calls.events).toBe(1)

    test.reader.handleHead(4)
    await flush()
    expect(test.calls.events).toBe(2)
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
    expect(test.calls.events).toBe(2)
  })

  it('surfaces a failed read and retries it on the next frame with the same head', async () => {
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
    expect(test.calls.events).toBe(2)
  })

  it('does nothing after stop', async () => {
    const test = rig()
    test.reader.stop()
    test.reader.start()
    test.reader.poke()
    test.reader.handleHead(9)
    await flush()
    expect(test.calls.events).toBe(0)
  })

  it('drops the result of a read that finishes after stop', async () => {
    const test = rig()
    test.reader.start()
    test.reader.stop()
    await flush()
    expect(test.state()).toBe(INITIAL_THREAD_EVENTS)
  })
})
