import { describe, expect, it } from 'bun:test'

import type { WireEvent } from '@dltech/atlas-wire/web'

import { createEventsPoller, INITIAL_THREAD_EVENTS, type ThreadEvents } from '../events-poller'

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

function rig(options?: { head?: () => number }) {
  const tasks: { delayMs: number; run: () => void; cancelled: boolean }[] = []
  const calls = { head: 0, events: 0 }
  let state: ThreadEvents = INITIAL_THREAD_EVENTS
  let headNow = 1
  const poller = () =>
    createEventsPoller({
      threadId: 'thr_1',
      fetchHead: async () => {
        calls.head += 1
        return { head: options?.head?.() ?? headNow }
      },
      fetchEvents: async () => {
        calls.events += 1
        return [event(1)]
      },
      onUpdate: (update) => {
        state = update(state)
      },
      schedule: (task) => {
        const entry = { ...task, cancelled: false }
        tasks.push(entry)
        return () => {
          entry.cancelled = true
        }
      },
    })
  return {
    poller,
    calls,
    tasks,
    state: () => state,
    setHead: (head: number) => {
      headNow = head
    },
  }
}

describe('createEventsPoller', () => {
  it('loads head then events, and only refetches events when the head moves', async () => {
    const test = rig()
    test.poller().start()
    await flush()
    expect(test.calls).toEqual({ head: 1, events: 1 })
    expect(test.state().loaded).toBe(true)

    test.tasks.at(-1)?.run()
    await flush()
    expect(test.calls).toEqual({ head: 2, events: 1 })

    test.setHead(2)
    test.tasks.at(-1)?.run()
    await flush()
    expect(test.calls).toEqual({ head: 3, events: 2 })
  })

  it('backs off while the head stays put and snaps back when it moves', async () => {
    const test = rig()
    test.poller().start()
    await flush()
    const delays = () => test.tasks.map((task) => task.delayMs)
    expect(delays()).toEqual([1000])

    for (let tick = 0; tick < 4; tick += 1) {
      test.tasks.at(-1)?.run()
      await flush()
    }
    expect(delays()).toEqual([1000, 2000, 4000, 5000, 5000])

    test.setHead(2)
    test.tasks.at(-1)?.run()
    await flush()
    expect(delays().at(-1)).toBe(1000)
  })

  it('stops fetching after stop, even for an already scheduled tick', async () => {
    const test = rig()
    const poller = test.poller()
    poller.start()
    await flush()
    const pending = test.tasks.at(-1)

    poller.stop()
    pending?.run()
    await flush()

    expect(pending?.cancelled).toBe(true)
    expect(test.calls).toEqual({ head: 1, events: 1 })
  })

  it('resumes with a fresh events read when started again', async () => {
    const test = rig()
    const first = test.poller()
    first.start()
    await flush()
    first.stop()

    test.poller().start()
    await flush()

    expect(test.calls).toEqual({ head: 2, events: 2 })
  })

  it('polls at once on a poke instead of waiting out the idle backoff', async () => {
    const test = rig()
    const poller = test.poller()
    poller.start()
    await flush()
    for (let tick = 0; tick < 3; tick += 1) {
      test.tasks.at(-1)?.run()
      await flush()
    }
    const backedOff = test.tasks.at(-1)
    expect(backedOff?.delayMs).toBe(5000)

    test.setHead(2)
    poller.poke()
    await flush()

    expect(backedOff?.cancelled).toBe(true)
    expect(test.calls.events).toBe(2)
    expect(test.tasks.at(-1)?.delayMs).toBe(1000)
  })

  it('runs one more poll when poked while a poll is in flight', async () => {
    const test = rig()
    const poller = test.poller()
    poller.start()
    poller.poke()
    await flush()
    await flush()

    expect(test.calls.head).toBe(2)
    expect(test.tasks).toHaveLength(1)
  })

  it('keeps polling after a failure and surfaces the error', async () => {
    const tasks: (() => void)[] = []
    let state = INITIAL_THREAD_EVENTS
    const poller = createEventsPoller({
      threadId: 'thr_1',
      fetchHead: async () => {
        throw new Error('offline')
      },
      fetchEvents: async () => [],
      onUpdate: (update) => {
        state = update(state)
      },
      schedule: (task) => {
        tasks.push(task.run)
        return () => undefined
      },
    })

    poller.start()
    await flush()

    expect(state.error?.message).toBe('offline')
    expect(tasks).toHaveLength(1)
  })
})
