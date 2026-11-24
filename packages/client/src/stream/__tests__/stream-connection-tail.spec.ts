import { describe, expect, it } from 'bun:test'
import { initialSessionViewState, SESSION_VIEW_VERSION } from '@dltech/atlas-core'
import type { StreamServerMessage } from '@dltech/atlas-protocol'

import { EStreamConnectionState } from '../connection-machine'
import { createStreamConnection } from '../stream-connection'
import { createFakeScheduler, createFakeTransport, settle } from './support'

const READY = { type: 'ready', v: 1, connectionId: 'c1' } as const

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const brokenBase: StreamServerMessage = {
  type: 'base',
  id: 's1',
  cursor: { seq: 20, hash: 'a'.repeat(64) },
  visibility: { spans: [] },
  view: { version: 1 },
  durable: [],
  commandLog: [],
}

const setup = () => {
  const clock = createFakeScheduler()
  const fakes = createFakeTransport()
  const connection = createStreamConnection({
    transport: fakes.transport,
    scheduler: clock.scheduler,
  })
  return { connection, clock, ...fakes }
}

describe('the stream connection tail opt-in', () => {
  it('asks for the tail while the server accepts it', async () => {
    const { connection, follows } = setup()
    connection.follow({ sessionId: 'session-1' })
    await settle()
    expect(follows[0]?.input).toEqual({
      sessionId: 'session-1',
      tailViewVersion: SESSION_VIEW_VERSION,
    })
  })

  it('resubscribes without the tail when the server rejects the input', async () => {
    const { connection, follows } = setup()
    connection.follow({ sessionId: 'session-1' })
    await settle()
    follows[0]?.handlers.handleFailure(400)
    await settle()
    expect(follows).toHaveLength(2)
    expect(follows[0]?.closed).toBe(true)
    expect(follows[1]?.input).toEqual({ sessionId: 'session-1' })
    expect(connection.state()).not.toBe(EStreamConnectionState.Backoff)
  })

  it('keeps the tail opt-out for the rest of the connection', async () => {
    const { connection, follows } = setup()
    connection.follow({ sessionId: 'session-1' })
    await settle()
    follows[0]?.handlers.handleFailure(400)
    await settle()
    connection.follow({ sessionId: 'session-2' })
    await settle()
    expect(follows[2]?.input).toEqual({ sessionId: 'session-2' })
  })

  it('treats a 400 after a frame as an ordinary failure', async () => {
    const { connection, follows } = setup()
    connection.follow({ sessionId: 'session-1' })
    await settle()
    follows[0]?.handlers.handleFrame(READY)
    follows[0]?.handlers.handleFailure(400)
    await settle()
    expect(follows.at(-1)?.input?.tailViewVersion).toBe(SESSION_VIEW_VERSION)
    expect(connection.state()).toBe(EStreamConnectionState.Backoff)
  })

  it('replays from the start when the base is unreadable', async () => {
    const { connection, follows } = setup()
    connection.follow({ sessionId: 'session-1' })
    await settle()
    follows[0]?.handlers.handleFrame(READY)
    follows[0]?.handlers.handleFrame(brokenBase)
    await settle()
    expect(follows).toHaveLength(2)
    expect(follows[1]?.input).toEqual({ sessionId: 'session-1' })
  })

  it('resumes from the tail cursor after the base', async () => {
    const { connection, clock, follows } = setup()
    const followed = connection.follow({ sessionId: 'session-1' })
    await settle()
    follows[0]?.handlers.handleFrame(READY)
    follows[0]?.handlers.handleFrame({
      type: 'base',
      id: 's1',
      cursor: { seq: 4000, hash: 'b'.repeat(64) },
      visibility: { spans: [] },
      view: plain({ ...initialSessionViewState, at: 4000 }),
      durable: [],
      commandLog: [],
    })
    expect(followed.getSnapshot().cursor?.seq).toBe(4000)
    follows[0]?.handlers.handleFrame({ type: 'going-away', reconnectAfterMs: 250 })
    follows[0]?.handlers.handleEnd()
    clock.advance(250)
    await settle()
    expect(follows[1]?.input).toEqual({
      sessionId: 'session-1',
      afterSeq: 4000,
      afterHash: 'b'.repeat(64),
      tailViewVersion: SESSION_VIEW_VERSION,
    })
  })
})
