import { describe, expect, it } from 'bun:test'

import { SESSION_VIEW_VERSION } from '@dltech/atlas-core'
import { EStreamCacheOutcome } from '@dltech/atlas-protocol'

import { ESessionConnection } from '../follower-state'
import { createStreamConnection } from '../stream-connection'
import {
  createFakeScheduler,
  createFakeTransport,
  eventsMessage,
  headOf,
  mintUserEvents,
  settle,
} from './support'

const READY = { type: 'ready', v: 1, connectionId: 'c1' } as const

const setup = () => {
  const clock = createFakeScheduler()
  const fakes = createFakeTransport()
  const connection = createStreamConnection({
    transport: fakes.transport,
    scheduler: clock.scheduler,
  })
  return { connection, ...fakes }
}

const followedWithEvents = async (count: number) => {
  const fixture = setup()
  const first = fixture.connection.follow({ sessionId: 'session-1' })
  await settle()
  const events = mintUserEvents({ count })
  fixture.follows[0]?.handlers.handleFrame(READY)
  fixture.follows[0]?.handlers.handleFrame(eventsMessage({ id: 's1', events, live: true }))
  return { ...fixture, first, events }
}

describe('reopening a session the client just closed', () => {
  it('shows the transcript it had at once, before any frame arrives', async () => {
    const { connection, first } = await followedWithEvents(3)
    first.close()
    const reopened = connection.follow({ sessionId: 'session-1' })
    expect(reopened.getSnapshot().events).toHaveLength(3)
    expect(reopened.getSnapshot().connection).toBe(ESessionConnection.CatchingUp)
  })

  it('catches up from the head it already holds', async () => {
    const { connection, first, follows, events } = await followedWithEvents(3)
    first.close()
    connection.follow({ sessionId: 'session-1' })
    await settle()
    const head = headOf(events)
    expect(follows).toHaveLength(2)
    expect(follows[1]?.input).toEqual({
      sessionId: 'session-1',
      afterSeq: head.seq,
      afterHash: head.hash,
      tailViewVersion: SESSION_VIEW_VERSION,
      cache: EStreamCacheOutcome.Memory,
    })
  })

  it('keeps a stale handle from closing the reopened session', async () => {
    const { connection, first, follows } = await followedWithEvents(2)
    first.close()
    connection.follow({ sessionId: 'session-1' })
    await settle()
    first.close()
    expect(follows[1]?.closed).toBe(false)
  })

  it('starts a child thread apart from its session', async () => {
    const { connection, first } = await followedWithEvents(2)
    first.close()
    const thread = connection.follow({ sessionId: 'session-1', threadId: 'child-1' })
    expect(thread.getSnapshot().events).toHaveLength(0)
  })
})
