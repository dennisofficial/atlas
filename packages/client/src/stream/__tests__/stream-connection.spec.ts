import { describe, expect, it } from 'bun:test'

import type { PluginViewFold } from '@dltech/atlas-core'
import { EStreamErrorCode, STREAM_STALL_MS } from '@dltech/atlas-protocol'

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

const BACKOFF_MS = 250

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

  it('sends the thread id when it follows a child thread', async () => {
    const { connection, follows } = setup()
    connection.follow({ sessionId: 'session-1', threadId: 'child-1' })
    await settle()
    expect(follows[0]?.input).toEqual({ sessionId: 'session-1', threadId: 'child-1' })
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

  it('fails a silent subscription over and resumes from the frame it last saw', async () => {
    const { connection, clock, follows } = setup()
    connection.follow({ sessionId: 'session-1' })
    await settle()
    const events = mintUserEvents({ count: 3 })
    const head = headOf(events)
    follows[0]?.handlers.handleFrame(READY)
    follows[0]?.handlers.handleFrame(eventsMessage({ id: 's1', events, live: true }))

    clock.advance(STREAM_STALL_MS - 1)
    expect(follows[0]?.closed).toBe(false)
    clock.advance(1)
    expect(follows[0]?.closed).toBe(true)
    expect(connection.state()).toBe(EStreamConnectionState.Backoff)

    clock.advance(BACKOFF_MS)
    await settle()
    expect(follows).toHaveLength(2)
    expect(follows[1]?.input).toEqual({
      sessionId: 'session-1',
      afterSeq: head.seq,
      afterHash: head.hash,
    })
  })

  it('keeps a subscription open while frames and pongs arrive', async () => {
    const { connection, clock, follows } = setup()
    connection.follow({ sessionId: 'session-1' })
    await settle()
    follows[0]?.handlers.handleFrame(READY)

    for (let beat = 0; beat < 3; beat += 1) {
      clock.advance(STREAM_STALL_MS - 1_000)
      follows[0]?.handlers.handleFrame({ type: 'pong' })
    }

    expect(follows[0]?.closed).toBe(false)
    expect(connection.state()).toBe(EStreamConnectionState.Open)
    expect(follows).toHaveLength(1)
  })

  it('never fires the watchdog of a closed connection', async () => {
    const { connection, clock, follows } = setup()
    connection.follow({ sessionId: 'session-1' })
    await settle()
    follows[0]?.handlers.handleFrame(READY)

    connection.close()
    expect(connection.state()).toBe(EStreamConnectionState.Closed)
    clock.advance(STREAM_STALL_MS * 2)
    await settle()

    expect(follows).toHaveLength(1)
    expect(connection.state()).toBe(EStreamConnectionState.Closed)
    expect(clock.pendingCount()).toBe(0)
  })

  it('watches the sessions list for a stall too', async () => {
    const { connection, clock, lists } = setup()
    connection.followSessions()
    await settle()
    lists[0]?.handlers.handleFrame({ type: 'snapshot', id: 'l1', rows })

    clock.advance(STREAM_STALL_MS)
    expect(lists[0]?.closed).toBe(true)
    clock.advance(BACKOFF_MS)
    await settle()

    expect(lists).toHaveLength(2)
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

  it('resubscribes a list the server ends with an error frame', async () => {
    const { connection, clock, lists } = setup()
    const list = connection.followSessions()
    await settle()
    lists[0]?.handlers.handleFrame({ type: 'snapshot', id: 'l1', rows })
    lists[0]?.handlers.handleFrame({ type: 'error', id: 'l1', code: EStreamErrorCode.Internal })
    expect(lists[0]?.closed).toBe(true)
    expect(connection.state()).toBe(EStreamConnectionState.Connecting)
    expect(lists).toHaveLength(1)

    clock.advance(BACKOFF_MS)
    await settle()
    expect(lists).toHaveLength(2)

    const fresh = [{ sessionId: 's9', title: 'nine' }] as never
    lists[1]?.handlers.handleFrame({ type: 'snapshot', id: 'l2', rows: fresh })
    expect(list.getSnapshot()).toEqual(fresh)

    lists[1]?.handlers.handleFrame({ type: 'error', id: 'l2', code: EStreamErrorCode.Internal })
    clock.advance(BACKOFF_MS)
    await settle()
    expect(lists).toHaveLength(3)
  })

  it('keeps the socket open when a list error frame is followed by the stream ending', async () => {
    const { connection, clock, lists } = setup()
    connection.followSessions()
    await settle()
    lists[0]?.handlers.handleFrame({ type: 'error', id: 'l1', code: EStreamErrorCode.Internal })
    lists[0]?.handlers.handleEnd()
    lists[0]?.handlers.handleFailure(500)
    expect(connection.state()).toBe(EStreamConnectionState.Connecting)
    expect(clock.pendingCount()).toBe(1)

    clock.advance(BACKOFF_MS)
    await settle()
    expect(lists).toHaveLength(2)
  })

  it('backs off between repeated list error frames', async () => {
    const { connection, clock, lists } = setup()
    connection.followSessions()
    await settle()
    const failList = (index: number): void => {
      lists[index]?.handlers.handleFrame({
        type: 'error',
        id: 'l1',
        code: EStreamErrorCode.Internal,
      })
    }
    failList(0)
    clock.advance(BACKOFF_MS)
    await settle()
    expect(lists).toHaveLength(2)

    failList(1)
    clock.advance(BACKOFF_MS)
    await settle()
    expect(lists).toHaveLength(2)

    clock.advance(BACKOFF_MS)
    await settle()
    expect(lists).toHaveLength(3)
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
