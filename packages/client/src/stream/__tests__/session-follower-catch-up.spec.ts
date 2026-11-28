import { describe, expect, it } from 'bun:test'
import { EStreamResetReason } from '@dltech/atlas-protocol'

import { EStreamConnectionState } from '../connection-machine'
import { CATCH_UP_HOLD_MS } from '../follower-render'
import { memorySessionLog, type SessionLog } from '../session-log'
import { createSessionFollower, ESessionConnection } from '../session-follower'
import { createFakeScheduler, eventsMessage, headOf, mintUserEvents, settle } from './support'

const setup = (log: SessionLog = memorySessionLog()) => {
  const clock = createFakeScheduler()
  const follower = createSessionFollower({
    sessionId: 'session-1',
    log,
    scheduler: clock.scheduler,
    onResnap: () => undefined,
  })
  let calls = 0
  follower.subscribe(() => void (calls += 1))
  return { follower, clock, log, calls: () => calls }
}

const seqs = (follower: ReturnType<typeof createSessionFollower>): number[] =>
  follower.getSnapshot().events.map((event) => event.seq)

describe('the session follower catch-up render', () => {
  it('holds every catch-up page back from listeners until the live frame', () => {
    const { follower, clock, calls } = setup()
    const events = mintUserEvents({ count: 6 })

    follower.handleMessage(eventsMessage({ id: 's1', events: events.slice(0, 2), live: false }))
    clock.advance(1_000)
    follower.handleMessage(eventsMessage({ id: 's1', events: events.slice(2, 4), live: false }))
    clock.advance(1_000)
    follower.handleMessage(eventsMessage({ id: 's1', events: events.slice(4, 5), live: false }))
    clock.advance(1_000)

    expect(calls()).toBe(0)
    expect(seqs(follower)).toEqual([])

    follower.handleMessage(eventsMessage({ id: 's1', events: events.slice(5), live: true }))

    expect(calls()).toBe(1)
    expect(seqs(follower)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('renders the held pages after the five-second safety hold', () => {
    expect(CATCH_UP_HOLD_MS).toBe(5_000)
    const { follower, clock, calls } = setup()
    const events = mintUserEvents({ count: 4 })

    follower.handleMessage(eventsMessage({ id: 's1', events: events.slice(0, 2), live: false }))
    clock.advance(CATCH_UP_HOLD_MS - 1)
    expect(calls()).toBe(0)

    clock.advance(1)
    expect(calls()).toBe(1)
    expect(seqs(follower)).toEqual([1, 2])

    follower.handleMessage(eventsMessage({ id: 's1', events: events.slice(2), live: false }))
    clock.advance(CATCH_UP_HOLD_MS)
    expect(calls()).toBe(2)
    expect(seqs(follower)).toEqual([1, 2, 3, 4])
  })

  it('notifies for every live frame once catch-up has settled', () => {
    const { follower, calls } = setup()
    const events = mintUserEvents({ count: 3 })

    follower.handleMessage(eventsMessage({ id: 's1', events: events.slice(0, 2), live: false }))
    expect(calls()).toBe(0)

    follower.handleMessage(eventsMessage({ id: 's1', events: events.slice(2), live: true }))
    expect(calls()).toBe(1)

    const live = mintUserEvents({ count: 1, from: headOf(events) })
    follower.handleMessage(eventsMessage({ id: 's1', events: live, live: true }))
    expect(calls()).toBe(2)

    const late = mintUserEvents({ count: 1, from: headOf(live) })
    follower.handleMessage(eventsMessage({ id: 's1', events: late, live: false }))
    expect(calls()).toBe(3)
    expect(seqs(follower)).toEqual([1, 2, 3, 4, 5])
  })

  it('renders the held pages when the connection changes', () => {
    const { follower, calls } = setup()

    follower.handleMessage(
      eventsMessage({ id: 's1', events: mintUserEvents({ count: 2 }), live: false }),
    )
    expect(calls()).toBe(0)

    follower.setConnection(EStreamConnectionState.Open)

    expect(calls()).toBe(1)
    expect(seqs(follower)).toEqual([1, 2])
    expect(follower.getSnapshot().connection).toBe(ESessionConnection.CatchingUp)
  })

  it('drops a pending catch-up render on reset', () => {
    const { follower, clock, calls } = setup()

    follower.handleMessage(
      eventsMessage({ id: 's1', events: mintUserEvents({ count: 2 }), live: false }),
    )
    expect(calls()).toBe(0)

    follower.handleMessage({
      type: 'reset',
      id: 's1',
      reason: EStreamResetReason.Fork,
      tailFrom: 0,
    })

    expect(calls()).toBe(1)
    clock.advance(CATCH_UP_HOLD_MS)
    expect(calls()).toBe(1)
    expect(seqs(follower)).toEqual([])
  })

  it('still appends catch-up pages to the session log', async () => {
    const { follower, log } = setup()

    follower.handleMessage(
      eventsMessage({ id: 's1', events: mintUserEvents({ count: 2 }), live: false }),
    )
    await settle()

    expect(
      (await log.readTail({ sessionId: 'session-1', count: 10 })).map((event) => event.seq),
    ).toEqual([1, 2])
  })
})
