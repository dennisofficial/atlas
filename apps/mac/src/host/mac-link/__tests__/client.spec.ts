import { describe, expect, test } from 'bun:test'
import type { MacClientFrame, MacHostFrame } from '@dltech/atlas-protocol/mac-link'

import { BACKOFF_BASE_MS, createMacLinkClient, type MacFrameSink } from '../client'

type FakeSocket = {
  sent: string[]
  closed: { code: number | undefined; reason: string }[]
  onopen: (() => void) | undefined
  onmessage: ((event: { data: string }) => void) | undefined
  onclose: ((event: { code: number }) => void) | undefined
  onerror: (() => void) | undefined
  send: (payload: string) => void
  close: (code?: number, reason?: string) => void
}

const harness = () => {
  const sockets: FakeSocket[] = []
  const urls: { url: string; headers: Record<string, string> }[] = []
  const delays: number[] = []
  const pending = new Map<number, () => void>()
  let next = 1
  const socketOf = (url: string, init: { headers: Record<string, string> }): WebSocket => {
    urls.push({ url, headers: init.headers })
    const socket: FakeSocket = {
      sent: [],
      closed: [],
      onopen: undefined,
      onmessage: undefined,
      onclose: undefined,
      onerror: undefined,
      send: (payload) => socket.sent.push(payload),
      close: (code, reason) => socket.closed.push({ code, reason: reason ?? '' }),
    }
    sockets.push(socket)
    return socket as unknown as WebSocket
  }
  return {
    sockets,
    urls,
    delays,
    socketOf,
    timers: {
      setTimeout: ((fn: () => void, ms: number) => {
        const id = next++
        delays.push(ms)
        pending.set(id, fn)
        return id
      }) as unknown as typeof setTimeout,
      clearTimeout: ((id: number) => {
        pending.delete(id)
      }) as unknown as typeof clearTimeout,
    },
    pending: () => pending.size,
    fire: (): void => {
      const due = [...pending.values()]
      pending.clear()
      for (const fn of due) fn()
    },
  }
}

const framesOf = (socket: FakeSocket): MacClientFrame[] =>
  socket.sent.map((payload) => JSON.parse(payload) as MacClientFrame)

const host = (frame: MacHostFrame): string => JSON.stringify(frame)

const clientOf = (
  args: {
    token?: string | undefined
    sink?: (emit: (frame: MacClientFrame) => void) => MacFrameSink
  } = {},
) => {
  const fake = harness()
  const client = createMacLinkClient({
    apiOrigin: 'http://api.example.test/',
    token: () => ('token' in args ? args.token : 'tok-1'),
    deviceId: () => 'dev-1',
    appVersion: () => '1.2.3',
    socketOf: fake.socketOf,
    timers: fake.timers,
    random: () => 0.5,
    ...(args.sink === undefined ? {} : { sink: args.sink }),
  })
  return { client, fake }
}

describe('createMacLinkClient', () => {
  test('opens the ws url with the bearer and says hello with a stable device id', () => {
    const { client, fake } = clientOf()
    client.start()
    fake.sockets[0]?.onopen?.()

    expect(fake.urls[0]).toEqual({
      url: 'ws://api.example.test/mac-link',
      headers: { authorization: 'Bearer tok-1' },
    })
    expect(framesOf(fake.sockets[0] as FakeSocket)).toEqual([
      { type: 'hello', v: 1, token: 'tok-1', deviceId: 'dev-1', appVersion: '1.2.3' },
    ])
  })

  test('never opens a socket while signed out', () => {
    const { client, fake } = clientOf({ token: undefined })
    client.start()

    expect(fake.sockets).toEqual([])
    expect(client.status()).toEqual({ connected: false, attempts: 0 })
  })

  test('reports connected only after ready', () => {
    const { client, fake } = clientOf()
    client.start()
    expect(client.status().connected).toBe(false)

    fake.sockets[0]?.onmessage?.({ data: host({ type: 'ready', deviceId: 'dev-1' }) })

    expect(client.status().connected).toBe(true)
  })

  test('answers a ping with a pong', () => {
    const { client, fake } = clientOf()
    client.start()
    fake.sockets[0]?.onopen?.()
    fake.sockets[0]?.onmessage?.({ data: host({ type: 'ping' }) })

    expect(framesOf(fake.sockets[0] as FakeSocket).at(-1)).toEqual({ type: 'pong' })
  })

  test('hands open, rpc and close frames to the sink', () => {
    const seen: string[] = []
    const { client, fake } = clientOf({
      sink: () => ({
        open: (args) => seen.push(`open:${args.channelId}`),
        rpc: (args) => seen.push(`rpc:${args.channelId}`),
        close: (args) => seen.push(`close:${args.channelId}`),
        disconnected: () => seen.push('disconnected'),
      }),
    })
    client.start()
    fake.sockets[0]?.onmessage?.({
      data: host({
        type: 'open',
        channelId: 'c1',
        server: { name: 'paper', transport: { kind: 'stdio', command: 'paper' } },
      }),
    })
    fake.sockets[0]?.onmessage?.({
      data: host({ type: 'rpc', channelId: 'c1', message: { jsonrpc: '2.0', id: 1 } }),
    })
    fake.sockets[0]?.onmessage?.({ data: host({ type: 'close', channelId: 'c1' }) })

    expect(seen).toEqual(['open:c1', 'rpc:c1', 'close:c1'])
  })

  test('reconnects with backoff after a drop and resets attempts on ready', () => {
    const { client, fake } = clientOf()
    client.start()
    fake.sockets[0]?.onclose?.({ code: 1006 })

    expect(fake.delays).toEqual([BACKOFF_BASE_MS])
    expect(client.status().attempts).toBe(1)

    fake.fire()
    expect(fake.sockets).toHaveLength(2)

    fake.sockets[1]?.onmessage?.({ data: host({ type: 'ready', deviceId: 'dev-1' }) })
    expect(client.status().attempts).toBe(0)

    fake.sockets[1]?.onclose?.({ code: 1006 })
    expect(fake.delays).toEqual([BACKOFF_BASE_MS, BACKOFF_BASE_MS])
  })

  test('stops reconnecting on a rejected token', () => {
    const { client, fake } = clientOf()
    client.start()
    fake.sockets[0]?.onclose?.({ code: 4401 })

    expect(fake.pending()).toBe(0)
    expect(client.status().connected).toBe(false)
  })

  test('stop clears the pending reconnect and closes the socket', () => {
    const { client, fake } = clientOf()
    client.start()
    fake.sockets[0]?.onclose?.({ code: 1006 })
    expect(fake.pending()).toBe(1)

    client.stop()

    expect(fake.pending()).toBe(0)
    fake.fire()
    expect(fake.sockets).toHaveLength(1)
  })

  test('sends a frame only while a socket is held', () => {
    const { client, fake } = clientOf()
    client.start()
    client.send({ type: 'pong' })

    expect(framesOf(fake.sockets[0] as FakeSocket)).toEqual([{ type: 'pong' }])

    client.stop()
    client.send({ type: 'pong' })
    expect(framesOf(fake.sockets[0] as FakeSocket)).toEqual([{ type: 'pong' }])
  })

  test('ignores a malformed host frame', () => {
    const { client, fake } = clientOf()
    client.start()
    fake.sockets[0]?.onmessage?.({ data: 'not json' })

    expect(client.status().connected).toBe(false)
  })
})
