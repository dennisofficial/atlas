import { afterEach, describe, expect, it } from 'bun:test'

import { FaultProxy, type ProxyFault } from '../fault-proxy'

type EchoServer = { port: number; stop(): void }

const startEcho = (): EchoServer => {
  const server = Bun.listen<{ count: number }>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(socket) {
        socket.data = { count: 0 }
      },
      data(socket, chunk) {
        socket.write(chunk)
      },
    },
  })
  return { port: server.port, stop: () => server.stop(true) }
}

const roundTrip = async (args: { port: number; bytes: Uint8Array }): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = []
  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port: args.port,
    socket: {
      data(_socket, chunk) {
        chunks.push(new Uint8Array(chunk))
      },
    },
  })
  socket.write(args.bytes)
  const deadline = Date.now() + 5_000
  let total = 0
  while (total < args.bytes.byteLength && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  }
  socket.end()
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return joined
}

describe('FaultProxy', () => {
  const echo = startEcho()
  const running: { stop(): Promise<void> }[] = []

  const start = async (fault?: ProxyFault) => {
    const proxy = await FaultProxy.start({ target: { host: '127.0.0.1', port: echo.port } })
    if (fault !== undefined) proxy.set(fault)
    running.push(proxy)
    return proxy
  }

  afterEach(async () => {
    for (const proxy of running.splice(0)) await proxy.stop()
  })

  it('relays bytes both ways with no fault', async () => {
    const proxy = await start()
    const bytes = new TextEncoder().encode('hello through the proxy')
    expect(await roundTrip({ port: proxy.port, bytes })).toEqual(bytes)
  })

  it('adds latency to the round trip', async () => {
    const proxy = await start({ latencyMs: 200 })
    const bytes = new TextEncoder().encode('slow')
    const started = Date.now()
    expect(await roundTrip({ port: proxy.port, bytes })).toEqual(bytes)
    expect(Date.now() - started).toBeGreaterThanOrEqual(180)
  })

  it('blackholes: the socket stays open and nothing comes back', async () => {
    const proxy = await start({ blackhole: true })
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port: proxy.port,
      socket: { data() {} },
    })
    socket.write(new TextEncoder().encode('lost'))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(socket.readyState).not.toBe('closed')
    expect(proxy.connections()).toBeGreaterThan(0)
    socket.end()
  })

  it('refuses new connections while refuse is set, then recovers on clear', async () => {
    const proxy = await start({ refuse: true })
    let refused = false
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port: proxy.port,
      socket: {
        data() {},
        close() {
          refused = true
        },
        error() {
          refused = true
        },
      },
    })
    const deadline = Date.now() + 3_000
    while (!refused && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(refused).toBe(true)
    socket.end()
    proxy.clear()
    const bytes = new TextEncoder().encode('back')
    expect(await roundTrip({ port: proxy.port, bytes })).toEqual(bytes)
  })

  it('holds upstream bytes until cleared', async () => {
    const proxy = await start({ holdUpstream: true })
    const echoed: Uint8Array[] = []
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port: proxy.port,
      socket: {
        data(_socket, chunk) {
          echoed.push(new Uint8Array(chunk))
        },
      },
    })
    socket.write(new TextEncoder().encode('held'))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(echoed.length).toBe(0)
    proxy.clear()
    const deadline = Date.now() + 3_000
    while (echoed.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(new TextDecoder().decode(echoed[0])).toBe('held')
    socket.end()
  })

  it('drop closes live connections', async () => {
    const proxy = await start()
    let closed = false
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port: proxy.port,
      socket: {
        data() {},
        close() {
          closed = true
        },
        error() {
          closed = true
        },
      },
    })
    expect(proxy.connections()).toBeGreaterThan(0)
    proxy.drop()
    const deadline = Date.now() + 3_000
    while (!closed && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(closed).toBe(true)
    socket.end()
  })
})
