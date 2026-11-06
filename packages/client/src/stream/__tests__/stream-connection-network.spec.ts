import { describe, expect, it } from 'bun:test'
import { STREAM_PROTOCOL_VERSION } from '@dltech/atlas-protocol'

import { EStreamConnectionState, HANDSHAKE_LIMIT_MS } from '../connection-machine'
import { createStreamConnection } from '../stream-connection'
import { networkSignalOf, type StreamNetworkSignal } from '../stream-ports'
import { createFakeScheduler, createFakeSockets, settle } from './support'

const READY = {
  type: 'ready',
  v: STREAM_PROTOCOL_VERSION,
  connectionId: 'c1',
} as const

const setup = () => {
  const clock = createFakeScheduler()
  const fakes = createFakeSockets()
  const listeners = new Set<() => void>()
  const networkSignal: StreamNetworkSignal = (handleSignal) => {
    listeners.add(handleSignal)
    return () => listeners.delete(handleSignal)
  }
  const connection = createStreamConnection({
    url: 'wss://stream.test/v1/stream',
    getToken: () => Promise.resolve('token'),
    socket: fakes.factory,
    scheduler: clock.scheduler,
    networkSignal,
  })
  const signal = () => {
    for (const listener of [...listeners]) listener()
  }
  return { connection, clock, sockets: fakes.sockets, listeners, signal }
}

describe('the stream connection handshake deadline', () => {
  it('abandons a socket that never answers hello and reconnects', async () => {
    const { connection, clock, sockets } = setup()
    connection.connect()
    sockets[0]?.open()
    await settle()
    expect(connection.state()).toBe(EStreamConnectionState.Authenticating)
    clock.advance(HANDSHAKE_LIMIT_MS)
    expect(connection.state()).toBe(EStreamConnectionState.Backoff)
    expect(sockets[0]?.closedWith).toHaveLength(1)
    clock.advance(500)
    expect(sockets).toHaveLength(2)
    expect(connection.state()).toBe(EStreamConnectionState.Connecting)
  })

  it('abandons a socket that never opens', () => {
    const { connection, clock, sockets } = setup()
    connection.connect()
    clock.advance(HANDSHAKE_LIMIT_MS)
    expect(connection.state()).toBe(EStreamConnectionState.Backoff)
    expect(sockets[0]?.closedWith).toHaveLength(1)
  })

  it('leaves a ready connection alone', async () => {
    const { connection, clock, sockets } = setup()
    connection.connect()
    sockets[0]?.open()
    await settle()
    sockets[0]?.receive(READY)
    clock.advance(HANDSHAKE_LIMIT_MS * 2)
    expect(connection.state()).toBe(EStreamConnectionState.Open)
    expect(sockets[0]?.closedWith).toHaveLength(0)
  })
})

describe('the stream connection network trigger', () => {
  it('reconnects immediately when the network returns during backoff', () => {
    const { connection, sockets, signal } = setup()
    connection.connect()
    sockets[0]?.drop(1006)
    expect(connection.state()).toBe(EStreamConnectionState.Backoff)
    signal()
    expect(connection.state()).toBe(EStreamConnectionState.Connecting)
    expect(sockets).toHaveLength(2)
  })

  it('does nothing when the network signal fires while connected', async () => {
    const { connection, sockets, signal } = setup()
    connection.connect()
    sockets[0]?.open()
    await settle()
    sockets[0]?.receive(READY)
    signal()
    expect(connection.state()).toBe(EStreamConnectionState.Open)
    expect(sockets).toHaveLength(1)
  })

  it('subscribes once connected and unsubscribes on close', () => {
    const { connection, listeners } = setup()
    expect(listeners.size).toBe(0)
    connection.connect()
    expect(listeners.size).toBe(1)
    connection.close()
    expect(listeners.size).toBe(0)
  })
})

describe('networkSignalOf', () => {
  const documentOf = (visibilityState: string) =>
    Object.assign(new EventTarget(), { visibilityState })

  it('fires on online and on becoming visible, never when hidden', () => {
    const win = new EventTarget()
    const doc = documentOf('hidden')
    let fired = 0
    networkSignalOf({ win, doc })(() => {
      fired += 1
    })
    win.dispatchEvent(new Event('online'))
    expect(fired).toBe(1)
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(fired).toBe(1)
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(fired).toBe(2)
  })

  it('stops firing after unsubscribe', () => {
    const win = new EventTarget()
    const doc = documentOf('visible')
    let fired = 0
    const unsubscribe = networkSignalOf({ win, doc })(() => {
      fired += 1
    })
    unsubscribe()
    win.dispatchEvent(new Event('online'))
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(fired).toBe(0)
  })

  it('is a no-op without a window or a document', () => {
    let fired = 0
    const handleSignal = () => {
      fired += 1
    }
    networkSignalOf({ win: undefined, doc: documentOf('visible') })(handleSignal)()
    networkSignalOf({ win: new EventTarget(), doc: undefined })(handleSignal)()
    expect(fired).toBe(0)
  })
})
