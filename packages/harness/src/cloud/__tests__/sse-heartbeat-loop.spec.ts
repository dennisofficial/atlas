import { describe, expect, it } from 'bun:test'

import { CloudError } from '../cloud-transport'
import { createHeartbeatLoop } from '../sse-heartbeat-loop'
import type { BookEntry } from '../sse-pull-request-book'
import { EPullRequestLookup } from '../../plugins/github/pure'
import { createFakeTimerClock } from './fake-timer-clock'

const INTERVAL_MS = 60_000

const entryOf = (key: string): BookEntry => ({
  key,
  handle: { id: `sub_${key}`, repoFullName: 'owner/repo' },
  by: { kind: 'branch', branch: key },
  reading: { lookup: EPullRequestLookup.Absent },
})

const harness = (args: {
  keys: string[]
  random?: () => number
  beat?: (id: string) => Promise<void>
}) => {
  const entries = new Map(args.keys.map((key) => [key, entryOf(key)]))
  const fake = createFakeTimerClock(args.random)
  const beats: { id: string; at: number }[] = []
  const counters = { catchUps: 0, empties: 0 }
  const loop = createHeartbeatLoop({
    intervalMs: INTERVAL_MS,
    clock: {
      setTimeoutFn: fake.clock.setTimeoutFn!,
      clearTimeoutFn: fake.clock.clearTimeoutFn!,
      randomFn: fake.clock.randomFn!,
    },
    book: {
      entries: () => [...entries.values()],
      holding: ({ key }) => entries.get(key) ?? null,
    },
    beat: async ({ id }) => {
      beats.push({ id, at: fake.clock.now!() })
      await args.beat?.(id)
    },
    onEmpty: () => { counters.empties += 1 },
    onNeedsCatchUp: () => { counters.catchUps += 1 },
  })
  return { loop, fake, beats, counters, entries }
}

describe('heartbeat loop', () => {
  it('de-phases entries across the window instead of firing them together', async () => {
    const draws = [0, 0.1, 0.5, 0.9]
    let drawn = 0
    const h = harness({ keys: ['a', 'b', 'c'], random: () => draws[drawn++ % draws.length] ?? 0 })
    h.loop.start()

    await h.fake.advance(INTERVAL_MS * 2)

    const times = h.beats.map((beat) => beat.at)
    expect(times.length).toBeGreaterThanOrEqual(3)
    expect(new Set(times).size).toBe(times.length)
    h.loop.stop()
  })

  it('schedules the next tick only after the current heartbeats settle', async () => {
    const release: (() => void)[] = []
    const h = harness({
      keys: ['a'],
      beat: () => new Promise<void>((resolve) => { release.push(resolve) }),
    })
    h.loop.start()

    await h.fake.advance(INTERVAL_MS * 10)
    expect(h.beats).toHaveLength(1)

    release[0]?.()
    await Bun.sleep(0)
    await h.fake.advance(INTERVAL_MS * 3)
    expect(h.beats).toHaveLength(2)
    h.loop.stop()
  })

  it('does not ask for a catch-up after a single failed heartbeat', async () => {
    let calls = 0
    const h = harness({
      keys: ['a'],
      beat: async () => {
        calls += 1
        if (calls === 1) throw new CloudError({ status: 503, message: 'sick' })
      },
    })
    h.loop.start()

    await h.fake.advance(INTERVAL_MS * 4)

    expect(calls).toBeGreaterThanOrEqual(2)
    expect(h.counters.catchUps).toBe(0)
    h.loop.stop()
  })

  it('asks for a catch-up on the second consecutive failure, and a success resets the count', async () => {
    const outcomes = ['fail', 'ok', 'fail', 'fail']
    let calls = 0
    const h = harness({
      keys: ['a'],
      beat: async () => {
        const outcome = outcomes[calls++]
        if (outcome === 'fail') throw new CloudError({ status: 0, message: 'timeout' })
      },
    })
    h.loop.start()

    await h.fake.advance(INTERVAL_MS * 3)
    expect(calls).toBe(3)
    expect(h.counters.catchUps).toBe(0)

    await h.fake.advance(INTERVAL_MS)
    expect(calls).toBe(4)
    expect(h.counters.catchUps).toBe(1)
    h.loop.stop()
  })

  for (const status of [401, 403, 404]) {
    it(`asks for a catch-up immediately on a terminal ${status}`, async () => {
      const h = harness({
        keys: ['a'],
        beat: async () => { throw new CloudError({ status, message: 'terminal' }) },
      })
      h.loop.start()

      await h.fake.advance(INTERVAL_MS * 1.5)

      expect(h.beats).toHaveLength(1)
      expect(h.counters.catchUps).toBe(1)
      h.loop.stop()
    })
  }

  it('stops and reports an empty book instead of ticking forever', async () => {
    const h = harness({ keys: ['a'] })
    h.loop.start()
    h.entries.clear()

    await h.fake.advance(INTERVAL_MS * 3)

    expect(h.counters.empties).toBe(1)
    expect(h.beats).toHaveLength(0)
    expect(h.fake.pending()).toBe(0)
  })

  it('stop cancels every pending timer and a later start resumes', async () => {
    const h = harness({ keys: ['a'] })
    h.loop.start()
    await h.fake.advance(INTERVAL_MS + 1)
    h.loop.stop()
    expect(h.fake.pending()).toBe(0)

    const before = h.beats.length
    await h.fake.advance(INTERVAL_MS * 5)
    expect(h.beats).toHaveLength(before)

    h.loop.start()
    await h.fake.advance(INTERVAL_MS * 3)
    expect(h.beats.length).toBeGreaterThan(before)
    h.loop.stop()
  })
})
