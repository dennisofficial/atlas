import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import type { StreamServerMessage } from '@dltech/atlas-protocol'

import { EStreamConnectionState } from '../connection-machine'
import { memorySessionCache } from '../session-cache'
import { createSessionFollower, ESessionConnection } from '../session-follower'
import { createFakeScheduler, eventsMessage, headOf, mintUserEvents } from './support'

const setup = () => {
  const clock = createFakeScheduler()
  const follower = createSessionFollower({
    sessionId: 'session-1',
    cache: memorySessionCache(),
    scheduler: clock.scheduler,
    onResnap: () => undefined,
  })
  return { follower }
}

let warned: typeof console.warn

beforeEach(() => {
  warned = console.warn
  console.warn = () => undefined
})

afterEach(() => {
  console.warn = warned
})

const pageWithUnknownEvent = (): StreamServerMessage => {
  const events = mintUserEvents({ count: 2 })
  return {
    type: 'events',
    id: 's1',
    events: [{ ...events[0] }, { seq: 2, type: 'from-the-future' }],
    head: headOf(events),
    live: true,
  }
}

describe('a client whose schema is behind the host', () => {
  it('reads past an event it cannot read and counts it', () => {
    const { follower } = setup()
    follower.setServerEventTypes(['from-the-future', 'user-said'])
    follower.setConnection(EStreamConnectionState.Open)
    follower.handleMessage(pageWithUnknownEvent())
    const snapshot = follower.getSnapshot()
    expect(snapshot.connection).toBe(ESessionConnection.Live)
    expect(snapshot.events.map((event) => event.seq)).toEqual([1])
    expect(snapshot.cursor).toEqual(headOf(mintUserEvents({ count: 2 })))
    expect(snapshot.skipped).toBe(1)
    expect(snapshot.writerAhead).toBe(true)
  })

  it('keeps the count when a later page is clean', () => {
    const { follower } = setup()
    follower.setServerEventTypes(['from-the-future', 'user-said'])
    follower.setConnection(EStreamConnectionState.Open)
    follower.handleMessage(pageWithUnknownEvent())
    follower.handleMessage(
      eventsMessage({ id: 's1', events: mintUserEvents({ count: 3 }).slice(2), live: true }),
    )
    expect(follower.getSnapshot().skipped).toBe(1)
  })

  it('stays live on a readable page whatever the host can write', () => {
    const { follower } = setup()
    follower.setServerEventTypes(['from-the-future', 'user-said'])
    follower.setConnection(EStreamConnectionState.Open)
    follower.handleMessage(
      eventsMessage({ id: 's1', events: mintUserEvents({ count: 2 }), live: true }),
    )
    expect(follower.getSnapshot().connection).toBe(ESessionConnection.Live)
    expect(follower.getSnapshot().skipped).toBe(0)
  })

  it('takes a host that announces no types as nothing to compare against', () => {
    const { follower } = setup()
    follower.setServerEventTypes(undefined)
    follower.setConnection(EStreamConnectionState.Open)
    follower.handleMessage(pageWithUnknownEvent())
    expect(follower.getSnapshot().writerAhead).toBe(false)
    expect(follower.getSnapshot().skipped).toBe(1)
  })
})
