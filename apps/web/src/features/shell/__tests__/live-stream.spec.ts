import { describe, expect, it } from 'bun:test'

import { EThreadLiveFrame, type ThreadLiveFrame } from '@dltech/atlas-wire/web'

import type { Schedule } from '@/features/threads/data/thread-signals'

import { createThreadsLive, type AppliedLiveFrame, type LiveListHandlers } from '../live-stream'

import { threadOf } from './fixtures'

function fakeSchedule() {
  const tasks: Array<{ delayMs: number; run: () => void; live: boolean }> = []
  const schedule: Schedule = (task) => {
    const entry = { ...task, live: true }
    tasks.push(entry)
    return () => {
      entry.live = false
    }
  }
  const flush = () => {
    for (const task of tasks) {
      if (!task.live) continue
      task.live = false
      task.run()
    }
  }
  const delays = () => tasks.filter((task) => task.live).map((task) => task.delayMs)
  return { schedule, flush, delays }
}

function liveHarness(args: { schedule?: Schedule; now?: () => number } = {}) {
  const opens: Array<{ handlers: LiveListHandlers; unsubscribed: boolean }> = []
  const applied: AppliedLiveFrame[] = []
  const live = createThreadsLive({
    subscribe: (handlers) => {
      const open = { handlers, unsubscribed: false }
      opens.push(open)
      return {
        unsubscribe: () => {
          open.unsubscribed = true
        },
      }
    },
    onApplied: (frame) => applied.push(frame),
    ...(args.schedule === undefined ? {} : { schedule: args.schedule }),
    ...(args.now === undefined ? {} : { now: args.now }),
  })
  return { live, opens, applied }
}

const snapshotOf = (ids: string[]): ThreadLiveFrame => ({
  type: EThreadLiveFrame.Snapshot,
  rows: ids.map((id) => ({
    sessionId: `ses_${id}`,
    projectId: null,
    managedBySessionId: null,
    sortAt: '2026-10-24T12:00:00.000Z',
    rev: 1,
    thread: threadOf({ id }),
  })),
  projects: [],
})

const upsertOf = (id: string, rev: number): ThreadLiveFrame => ({
  type: EThreadLiveFrame.Upsert,
  row: {
    sessionId: `ses_${id}`,
    projectId: null,
    managedBySessionId: null,
    sortAt: '2026-10-24T12:00:00.000Z',
    rev,
    thread: threadOf({ id }),
  },
})

describe('createThreadsLive', () => {
  it('applies frames only after a fresh snapshot on open', () => {
    const { live, opens, applied } = liveHarness()
    live.start()
    expect(opens).toHaveLength(1)
    const first = opens[0]
    first?.handlers.onData(snapshotOf(['a', 'b']))
    expect(applied).toHaveLength(1)
    first?.handlers.onData(upsertOf('c', 2))
    expect(applied).toHaveLength(2)
    expect([...applied[1]!.state.rows.keys()].sort()).toEqual(['a', 'b', 'c'])
  })

  it('drops and reconnects when the first frame is not a snapshot', () => {
    const timers = fakeSchedule()
    const { live, opens } = liveHarness({ schedule: timers.schedule })
    live.start()
    opens[0]?.handlers.onData(upsertOf('early', 1))
    expect(opens[0]?.unsubscribed).toBe(true)
    expect(opens).toHaveLength(1)
    timers.flush()
    expect(opens).toHaveLength(2)
  })

  it('ignores heartbeats before the snapshot instead of reconnecting', () => {
    const { live, opens } = liveHarness()
    live.start()
    opens[0]?.handlers.onData({ type: EThreadLiveFrame.Heartbeat })
    expect(opens[0]?.unsubscribed).toBe(false)
    expect(opens).toHaveLength(1)
  })

  it('resync reopens the stream and expects a fresh snapshot', () => {
    const timers = fakeSchedule()
    const { live, opens, applied } = liveHarness({ schedule: timers.schedule })
    live.start()
    opens[0]?.handlers.onData(snapshotOf(['a']))
    opens[0]?.handlers.onData({ type: EThreadLiveFrame.Resync, reason: 'overflow' })
    expect(opens[0]?.unsubscribed).toBe(true)
    timers.flush()
    expect(opens).toHaveLength(2)
    opens[1]?.handlers.onData(upsertOf('stale', 9))
    expect(applied).toHaveLength(1)
    timers.flush()
    expect(opens).toHaveLength(3)
    opens[2]?.handlers.onData(snapshotOf(['b']))
    expect(applied).toHaveLength(2)
    expect([...applied[1]!.state.rows.keys()]).toEqual(['b'])
  })

  it('stamps each applied frame with the receive time', () => {
    let now = 1000
    const { live, opens, applied } = liveHarness({ now: () => now })
    live.start()
    opens[0]?.handlers.onData(snapshotOf(['a']))
    now = 2000
    opens[0]?.handlers.onData(upsertOf('b', 2))
    expect(applied.map((frame) => frame.at)).toEqual([1000, 2000])
  })

  it('backs off with reconnectDelayMs across failures', () => {
    const timers = fakeSchedule()
    const { live, opens } = liveHarness({ schedule: timers.schedule })
    live.start()
    opens[0]?.handlers.onError(new Error('down'))
    expect(timers.delays()).toEqual([1000])
    timers.flush()
    opens[1]?.handlers.onComplete()
    expect(timers.delays()).toEqual([2000])
    timers.flush()
    opens[2]?.handlers.onStarted()
    opens[2]?.handlers.onData(snapshotOf([]))
    opens[2]?.handlers.onStopped()
    expect(timers.delays()).toEqual([1000])
  })

  it('ignores late frames from a superseded subscription', () => {
    const timers = fakeSchedule()
    const { live, opens, applied } = liveHarness({ schedule: timers.schedule })
    live.start()
    opens[0]?.handlers.onData(snapshotOf(['a']))
    opens[0]?.handlers.onComplete()
    timers.flush()
    opens[0]?.handlers.onData(upsertOf('ghost', 9))
    opens[1]?.handlers.onData(snapshotOf(['b']))
    expect(applied).toHaveLength(2)
    expect([...applied[1]!.state.rows.keys()]).toEqual(['b'])
  })

  it('stop unsubscribes and blocks reopen', () => {
    const timers = fakeSchedule()
    const { live, opens } = liveHarness({ schedule: timers.schedule })
    live.start()
    opens[0]?.handlers.onError(new Error('down'))
    live.stop()
    timers.flush()
    expect(opens).toHaveLength(1)
    expect(opens[0]?.unsubscribed).toBe(true)
  })
})
