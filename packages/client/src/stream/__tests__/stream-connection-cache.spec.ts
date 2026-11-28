import { describe, expect, it } from 'bun:test'
import { SESSION_VIEW_VERSION } from '@dltech/atlas-core'
import { EStreamCacheOutcome } from '@dltech/atlas-protocol'

import { EStreamConnectionState } from '../connection-machine'
import { HYDRATE_TIMEOUT_MS } from '../follower-hydrate'
import { memorySessionLog, SESSION_LOG_STRUCTURE_VERSION } from '../session-log'
import { applyPage, EMPTY_WINDOW } from '../session-window'
import { createStreamConnection } from '../stream-connection'
import {
  createFakeScheduler,
  createFakeTransport,
  eventsMessage,
  headOf,
  mintUserEvents,
  settle,
} from './support'

const SESSION = 'session-1'
const READY = { type: 'ready', v: 1, connectionId: 'c1' } as const

const setup = () => {
  const clock = createFakeScheduler()
  const fakes = createFakeTransport()
  const connection = createStreamConnection({
    transport: fakes.transport,
    scheduler: clock.scheduler,
  })
  return { connection, clock, ...fakes }
}

describe('stream connection cache telemetry', () => {
  it('subscribes once the cache has hydrated, then follows the frames', async () => {
    const { connection, follows } = setup()
    const followed = connection.follow({ sessionId: SESSION })
    await settle()
    expect(follows).toHaveLength(1)
    expect(follows[0]?.input).toEqual({
      sessionId: SESSION,
      cache: EStreamCacheOutcome.Empty,
      hydrateMs: 0,
      tailViewVersion: SESSION_VIEW_VERSION,
    })
    const events = mintUserEvents({ count: 2 })
    follows[0]?.handlers.handleFrame(READY)
    follows[0]?.handlers.handleFrame(eventsMessage({ id: 's1', events, live: true }))
    expect(followed.getSnapshot().events).toHaveLength(2)
    expect(connection.state()).toBe(EStreamConnectionState.Open)
  })

  it('resumes from the last head after the server drains the stream', async () => {
    const { connection, clock, follows } = setup()
    const followed = connection.follow({ sessionId: SESSION })
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
      sessionId: SESSION,
      afterSeq: head.seq,
      afterHash: head.hash,
      cache: EStreamCacheOutcome.Resumed,
      tailViewVersion: SESSION_VIEW_VERSION,
    })
    follows[1]?.handlers.handleFrame(eventsMessage({ id: 's2', events, live: true }))
    expect(followed.getSnapshot().events).toHaveLength(3)
  })

  it('sends the thread id when it follows a child thread', async () => {
    const { connection, follows } = setup()
    connection.follow({ sessionId: SESSION, threadId: 'child-1' })
    await settle()
    expect(follows[0]?.input).toEqual({
      sessionId: SESSION,
      threadId: 'child-1',
      cache: EStreamCacheOutcome.Empty,
      hydrateMs: 0,
      tailViewVersion: SESSION_VIEW_VERSION,
    })
  })

  it('reports a restored cache together with its resume cursor', async () => {
    const log = memorySessionLog()
    const events = mintUserEvents({ count: 2 })
    const window = applyPage({ window: EMPTY_WINDOW, page: { events, head: headOf(events) } })
    await log.appendPage({ sessionId: SESSION, events, head: headOf(events) })
    await log.saveSnapshot({
      sessionId: SESSION,
      snapshot: { version: SESSION_LOG_STRUCTURE_VERSION, ...window, throughSeq: 2 },
    })
    const { connection, follows } = setup()
    const followed = connection.follow({ sessionId: SESSION, log })
    await followed.hydrated
    await settle()
    expect(follows[0]?.input).toMatchObject({
      cache: EStreamCacheOutcome.Restored,
      hydrateMs: 0,
      afterSeq: 2,
      afterHash: headOf(events).hash,
    })
  })

  it('reports a failed log instead of an empty cache', async () => {
    const { connection, follows } = setup()
    connection.follow({
      sessionId: SESSION,
      log: { ...memorySessionLog(), loadSnapshot: () => Promise.reject(new Error('open failed')) },
    })
    await settle()
    expect(follows[0]?.input).toMatchObject({ cache: EStreamCacheOutcome.Failed, hydrateMs: 0 })
  })

  it('reports a hydrate timeout once, then resumed on reconnect', async () => {
    const { connection, clock, follows } = setup()
    connection.follow({
      sessionId: SESSION,
      log: { ...memorySessionLog(), loadSnapshot: () => new Promise(() => undefined) },
    })
    await settle()
    expect(follows).toHaveLength(0)
    clock.advance(HYDRATE_TIMEOUT_MS)
    await settle()
    expect(follows[0]?.input).toMatchObject({
      cache: EStreamCacheOutcome.Timeout,
      hydrateMs: HYDRATE_TIMEOUT_MS,
    })
    follows[0]?.handlers.handleFailure(502)
    connection.reconnect()
    await settle()
    expect(follows[1]?.input?.cache).toBe(EStreamCacheOutcome.Resumed)
    expect(follows[1]?.input).not.toHaveProperty('hydrateMs')
  })
})
