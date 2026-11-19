import { describe, expect, it } from 'bun:test'

import type { PluginViewFold } from '@dltech/atlas-core'

import { EStreamConnectionState } from '../connection-machine'
import { createStreamConnection, type StreamConnectionArgs } from '../stream-connection'
import {
  createFakeScheduler,
  createFakeTransport,
  eventsMessage,
  headOf,
  mintUserEvents,
  settle,
} from './support'

const READY = { type: 'ready', v: 1, connectionId: 'c1' } as const

const setup = (extra: { views?: StreamConnectionArgs['views'] } = {}) => {
  const clock = createFakeScheduler()
  const fakes = createFakeTransport()
  const connection = createStreamConnection({
    transport: fakes.transport,
    scheduler: clock.scheduler,
    ...extra,
  })
  return { connection, clock, ...fakes }
}

const probeView: PluginViewFold<readonly number[]> = {
  name: 'probe',
  initial: [],
  fold: (state, event) => [...state, Number(event.seq)],
}

const rows = [
  {
    sessionId: 's1',
    title: 'one',
  },
] as never

describe('the stream connection', () => {
  it('subscribes once the cache has hydrated, then follows the frames', async () => {
    const { connection, follows } = setup()
    const followed = connection.follow({ sessionId: 'session-1' })
    await settle()
    expect(follows).toHaveLength(1)
    expect(follows[0]?.input).toEqual({ sessionId: 'session-1' })
    const events = mintUserEvents({ count: 2 })
    follows[0]?.handlers.handleFrame(READY)
    follows[0]?.handlers.handleFrame(eventsMessage({ id: 's1', events, live: true }))
    expect(followed.getSnapshot().events).toHaveLength(2)
    expect(connection.state()).toBe(EStreamConnectionState.Open)
  })

  it('resumes from the last head after the server drains the stream', async () => {
    const { connection, clock, follows } = setup()
    const followed = connection.follow({ sessionId: 'session-1' })
    await settle()
    const events = mintUserEvents({ count: 3 })
    follows[0]?.handlers.handleFrame(eventsMessage({ id: 's1', events, live: true }))
    const head = headOf(events)
    follows[0]?.handlers.handleFrame({ type: 'going-away', reconnectAfterMs: 800 })
    follows[0]?.handlers.handleEnd()
    expect(follows[0]?.closed).toBe(true)
    expect(connection.state()).toBe(EStreamConnectionState.Backoff)
    clock.advance(800)
    await settle()
    expect(follows).toHaveLength(2)
    expect(follows[1]?.input).toEqual({
      sessionId: 'session-1',
      afterSeq: head.seq,
      afterHash: head.hash,
    })
    follows[1]?.handlers.handleFrame(eventsMessage({ id: 's2', events, live: true }))
    expect(followed.getSnapshot().events).toHaveLength(3)
  })

  it('folds the plugin views it is handed into every followed session', async () => {
    const { connection, follows } = setup({ views: [probeView] })
    const followed = connection.follow({ sessionId: 'session-1' })
    await settle()
    follows[0]?.handlers.handleFrame(
      eventsMessage({ id: 's1', events: mintUserEvents({ count: 2 }), live: true }),
    )
    expect(followed.getSnapshot().view?.pluginViews).toEqual({ probe: [1, 2] })
  })

  it('aborts a subscription when the follower closes', async () => {
    const { connection, follows } = setup()
    const followed = connection.follow({ sessionId: 'session-1' })
    await settle()
    followed.close()
    expect(follows[0]?.closed).toBe(true)
  })

  it('closes every subscription when the connection closes', async () => {
    const { connection, follows, lists } = setup()
    connection.follow({ sessionId: 'session-1' })
    connection.followSessions()
    await settle()
    connection.close()
    expect(connection.state()).toBe(EStreamConnectionState.Closed)
    expect(follows[0]?.closed).toBe(true)
    expect(lists[0]?.closed).toBe(true)
  })

  it('folds the list snapshot, upserts and removes', async () => {
    const { connection, lists } = setup()
    const list = connection.followSessions()
    await settle()
    expect(lists).toHaveLength(1)
    lists[0]?.handlers.handleFrame({ type: 'snapshot', id: 'l1', rows })
    expect(list.getSnapshot()).toEqual(rows)
    lists[0]?.handlers.handleFrame({
      type: 'upsert',
      id: 'l1',
      row: { sessionId: 's2', title: 'two' } as never,
    })
    expect(list.getSnapshot()).toHaveLength(2)
    lists[0]?.handlers.handleFrame({ type: 'remove', id: 'l1', sessionId: 's2' })
    expect(list.getSnapshot()).toEqual(rows)
  })

  it('reconnects the list after a drain too', async () => {
    const { connection, clock, lists } = setup()
    connection.followSessions()
    await settle()
    lists[0]?.handlers.handleEnd()
    clock.advance(1_000)
    await settle()
    expect(lists).toHaveLength(2)
  })

  it('keeps retrying through repeated failures', async () => {
    const { connection, clock, follows } = setup()
    connection.follow({ sessionId: 'session-1' })
    await settle()
    clock.setRandom(1)
    follows[0]?.handlers.handleFailure(502)
    expect(connection.state()).toBe(EStreamConnectionState.Backoff)
    clock.advance(500)
    await settle()
    follows[1]?.handlers.handleFailure(502)
    expect(connection.state()).toBe(EStreamConnectionState.Backoff)
    clock.advance(1_000)
    await settle()
    expect(follows).toHaveLength(3)
    expect(follows[1]?.closed).toBe(true)
  })

  it('reconnects at once when a session is opened while it is backing off', async () => {
    const { connection, follows } = setup()
    connection.follow({ sessionId: 'session-1' })
    await settle()
    follows[0]?.handlers.handleFailure(502)
    expect(connection.state()).toBe(EStreamConnectionState.Backoff)
    connection.follow({ sessionId: 'session-2' })
    await settle()
    expect(connection.state()).toBe(EStreamConnectionState.Connecting)
    expect(follows.map((entry) => entry.input?.sessionId)).toEqual([
      'session-1',
      'session-1',
      'session-2',
    ])
    expect(follows[0]?.closed).toBe(true)
  })

  it('reconnects every followed session when asked', async () => {
    const { connection, lists, follows } = setup()
    connection.follow({ sessionId: 'session-1' })
    connection.followSessions()
    await settle()
    follows[0]?.handlers.handleFailure(500)
    connection.reconnect()
    await settle()
    expect(connection.state()).toBe(EStreamConnectionState.Connecting)
    expect(follows).toHaveLength(2)
    expect(lists).toHaveLength(2)
  })
})
