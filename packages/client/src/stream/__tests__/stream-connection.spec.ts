import { describe, expect, it } from 'bun:test'
import {
  EStreamBlockKind,
  EStreamSubscribeKind,
  STREAM_PROTOCOL_VERSION,
} from '@dltech/atlas-protocol'

import { EStreamConnectionState } from '../connection-machine'
import { createStreamConnection } from '../stream-connection'
import { ESessionConnection } from '../session-follower'
import {
  createFakeScheduler,
  createFakeSockets,
  eventsMessage,
  headOf,
  mintUserEvents,
  settle,
} from './support'

const READY = { type: 'ready', v: STREAM_PROTOCOL_VERSION, connectionId: 'c1' } as const

const setup = () => {
  const clock = createFakeScheduler()
  const fakes = createFakeSockets()
  const tokens: string[] = []
  const connection = createStreamConnection({
    url: 'wss://stream.test/v1/stream',
    getToken: () => {
      tokens.push(`token-${tokens.length + 1}`)
      return Promise.resolve(tokens[tokens.length - 1] as string)
    },
    socket: fakes.factory,
    scheduler: clock.scheduler,
  })
  return { connection, clock, sockets: fakes.sockets, tokens }
}

const bringUp = async (params: {
  sockets: ReturnType<typeof createFakeSockets>['sockets']
  index: number
}) => {
  const socket = params.sockets[params.index]
  if (socket === undefined) throw new Error('no socket')
  socket.open()
  await settle()
  socket.receive(READY)
  await settle()
  return socket
}

describe('the stream connection', () => {
  it('connects on the first follow, says hello with a token, then subscribes', async () => {
    const { connection, sockets } = setup()
    connection.follow({ sessionId: 'session-1' })
    expect(sockets).toHaveLength(1)
    expect(sockets[0]?.url).toBe('wss://stream.test/v1/stream')
    sockets[0]?.open()
    await settle()
    expect(sockets[0]?.sent).toEqual([
      { type: 'hello', v: STREAM_PROTOCOL_VERSION, token: 'token-1' },
    ])
    expect(connection.state()).toBe(EStreamConnectionState.Authenticating)
    sockets[0]?.receive(READY)
    await settle()
    expect(connection.state()).toBe(EStreamConnectionState.Open)
    expect(sockets[0]?.sent[1]).toEqual({
      type: 'subscribe',
      id: 's1',
      kind: EStreamSubscribeKind.Session,
      sessionId: 'session-1',
    })
  })

  it('routes messages to the follower they are addressed to', async () => {
    const { connection, sockets } = setup()
    const first = connection.follow({ sessionId: 'session-1' })
    const second = connection.follow({ sessionId: 'session-2' })
    const socket = await bringUp({ sockets, index: 0 })
    expect(
      socket.sent.slice(1).map((message) => message.type === 'subscribe' && message.id),
    ).toEqual(['s1', 's2'])
    socket.receive(eventsMessage({ id: 's2', events: mintUserEvents({ count: 2 }), live: true }))
    expect(first.getSnapshot().events).toHaveLength(0)
    expect(second.getSnapshot().events).toHaveLength(2)
    expect(second.getSnapshot().connection).toBe(ESessionConnection.Live)
  })

  it('resubscribes with the cursor after a drop', async () => {
    const { connection, clock, sockets } = setup()
    const follower = connection.follow({ sessionId: 'session-1' })
    const first = await bringUp({ sockets, index: 0 })
    const events = mintUserEvents({ count: 3 })
    first.receive(eventsMessage({ id: 's1', events, live: true }))
    first.drop(1006)
    expect(connection.state()).toBe(EStreamConnectionState.Backoff)
    expect(follower.getSnapshot().connection).toBe(ESessionConnection.Reconnecting)
    expect(follower.getSnapshot().events).toHaveLength(3)

    clock.advance(500)
    expect(sockets).toHaveLength(2)
    const second = await bringUp({ sockets, index: 1 })
    expect(second.sent[1]).toEqual({
      type: 'subscribe',
      id: 's1',
      kind: EStreamSubscribeKind.Session,
      sessionId: 'session-1',
      afterSeq: 3,
      afterHash: headOf(events).hash,
    })
    expect(follower.getSnapshot().connection).toBe(ESessionConnection.CatchingUp)
  })

  it('does not reconnect after a closing 4401 even when the socket closes with 1005', async () => {
    const { connection, clock, sockets, tokens } = setup()
    const follower = connection.follow({ sessionId: 'session-1' })
    const socket = await bringUp({ sockets, index: 0 })
    socket.receive({ type: 'closing', code: 4401 })
    socket.drop(1005)
    clock.advance(60_000)
    expect(sockets).toHaveLength(1)
    expect(connection.state()).toBe(EStreamConnectionState.Closed)
    expect(follower.getSnapshot().connection).toBe(ESessionConnection.Offline)

    connection.connect()
    expect(sockets).toHaveLength(2)
    sockets[1]?.open()
    await settle()
    expect(tokens).toEqual(['token-1', 'token-2'])
  })

  it('waits exactly the going-away delay before reconnecting', async () => {
    const { connection, clock, sockets } = setup()
    connection.follow({ sessionId: 'session-1' })
    const socket = await bringUp({ sockets, index: 0 })
    socket.receive({ type: 'going-away', reconnectAfterMs: 2500 })
    socket.drop(1001)
    clock.advance(2499)
    expect(sockets).toHaveLength(1)
    clock.advance(1)
    expect(sockets).toHaveLength(2)
  })

  it('reconnects after 45 seconds of silence', async () => {
    const { connection, clock, sockets } = setup()
    connection.follow({ sessionId: 'session-1' })
    const socket = await bringUp({ sockets, index: 0 })
    clock.advance(45_000)
    expect(socket.closedWith).toHaveLength(1)
    expect(connection.state()).toBe(EStreamConnectionState.Backoff)
    clock.advance(15_000)
    expect(sockets).toHaveLength(2)
  })

  it('ignores events from a socket it has already replaced', async () => {
    const { connection, clock, sockets } = setup()
    const follower = connection.follow({ sessionId: 'session-1' })
    const first = await bringUp({ sockets, index: 0 })
    clock.advance(45_000)
    first.receive(eventsMessage({ id: 's1', events: mintUserEvents({ count: 1 }), live: true }))
    expect(follower.getSnapshot().events).toHaveLength(0)
  })

  it('sends resnap for the follower that saw a delta gap', async () => {
    const { connection, sockets } = setup()
    connection.follow({ sessionId: 'session-1' })
    const socket = await bringUp({ sockets, index: 0 })
    const key = { runId: 'run-1', step: 1, attempt: 0 }
    socket.receive({ type: 'overlay', id: 's1', key, blocks: [] })
    socket.receive({
      type: 'delta',
      id: 's1',
      key,
      block: 'b0',
      kind: EStreamBlockKind.Text,
      from: 8,
      text: 'x',
    })
    expect(socket.sent[socket.sent.length - 1]).toEqual({ type: 'resnap', id: 's1' })
  })

  it('unsubscribes a closed follower and stops routing to it', async () => {
    const { connection, sockets } = setup()
    const follower = connection.follow({ sessionId: 'session-1' })
    const socket = await bringUp({ sockets, index: 0 })
    follower.close()
    expect(socket.sent[socket.sent.length - 1]).toEqual({ type: 'unsubscribe', id: 's1' })
    socket.receive(eventsMessage({ id: 's1', events: mintUserEvents({ count: 1 }), live: true }))
    expect(follower.getSnapshot().events).toHaveLength(0)
  })

  it('closes the socket for good on close()', async () => {
    const { connection, clock, sockets } = setup()
    const follower = connection.follow({ sessionId: 'session-1' })
    const socket = await bringUp({ sockets, index: 0 })
    connection.close()
    expect(socket.closedWith).toHaveLength(1)
    expect(connection.state()).toBe(EStreamConnectionState.Closed)
    clock.advance(60_000)
    expect(sockets).toHaveLength(1)
    expect(follower.getSnapshot().connection).toBe(ESessionConnection.Offline)
  })
})
