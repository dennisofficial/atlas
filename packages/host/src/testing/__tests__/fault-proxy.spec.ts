import { afterEach, describe, expect, it } from 'bun:test'

import { FaultProxy, type ProxyFault } from '../fault-proxy'

type EchoServer = { port: number; stop(): void }

const startEcho = (prefix?: string): EchoServer => {
  const tag = prefix === undefined ? new Uint8Array() : new TextEncoder().encode(prefix)
  const pump = (socket: {
    data: { queue: Uint8Array[] }
    write(chunk: Uint8Array): number
  }): void => {
    const { queue } = socket.data
    while (queue.length > 0) {
      const head = queue[0]
      if (head === undefined) return
      const written = socket.write(head)
      if (written < head.byteLength) {
        queue[0] = head.subarray(written)
        return
      }
      queue.shift()
    }
  }
  const server = Bun.listen<{ queue: Uint8Array[] }>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(socket) {
        socket.data = { queue: [] }
      },
      data(socket, chunk) {
        const tagged = new Uint8Array(tag.byteLength + chunk.byteLength)
        tagged.set(tag)
        tagged.set(new Uint8Array(chunk), tag.byteLength)
        socket.data.queue.push(tagged)
        pump(socket)
      },
      drain(socket) {
        pump(socket)
      },
    },
  })
  return { port: server.port, stop: () => server.stop(true) }
}

const roundTrip = async (args: { port: number; bytes: Uint8Array }): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = []
  let sent = 0
  const socket = await Bun.connect({
    hostname: '127.0.0.1',
    port: args.port,
    socket: {
      data(_socket, chunk) {
        chunks.push(new Uint8Array(chunk))
      },
      drain(ready) {
        while (sent < args.bytes.byteLength) {
          const written = ready.write(args.bytes.subarray(sent))
          if (written === 0) return
          sent += written
        }
      },
    },
  })
  while (sent < args.bytes.byteLength) {
    const written = socket.write(args.bytes.subarray(sent))
    if (written === 0) break
    sent += written
  }
  const deadline = Date.now() + 15_000
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

  it('holds downstream bytes until cleared', async () => {
    const proxy = await start({ holdDownstream: true })
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

  it('keeps every byte in order through a downstream throttle', async () => {
    const proxy = await start({ bytesPerSecond: 4_000_000 })
    const size = 5 * 1024 * 1024
    const bytes = new Uint8Array(size)
    for (let i = 0; i < size; i += 1) bytes[i] = i % 251
    const echoed = await roundTrip({ port: proxy.port, bytes })
    expect(echoed.byteLength).toBe(size)
    expect(echoed).toEqual(bytes)
  }, 30_000)

  it('holds upstream bytes written before the target connection opened', async () => {
    const proxy = await start({ holdUpstream: true })
    const echoed: Uint8Array[] = []
    const socketPromise = Bun.connect({
      hostname: '127.0.0.1',
      port: proxy.port,
      socket: {
        data(_socket, chunk) {
          echoed.push(new Uint8Array(chunk))
        },
      },
    })
    const socket = await socketPromise
    socket.write(new TextEncoder().encode('early'))
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(echoed.length).toBe(0)
    proxy.clear()
    const deadline = Date.now() + 3_000
    while (echoed.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(new TextDecoder().decode(echoed[0])).toBe('early')
    socket.end()
  })

  it('holds a latency-scheduled upstream send when hold is set mid-flight', async () => {
    const proxy = await start({ latencyMs: 300 })
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
    socket.write(new TextEncoder().encode('in-flight'))
    proxy.set({ holdUpstream: true })
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(echoed.length).toBe(0)
    proxy.clear()
    const deadline = Date.now() + 3_000
    while (echoed.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(new TextDecoder().decode(echoed[0])).toBe('in-flight')
    socket.end()
  })

  it('retarget drops live connections and relays new ones to the new target', async () => {
    const first = startEcho('first:')
    const second = startEcho('second:')
    const proxy = await FaultProxy.start({ target: { host: '127.0.0.1', port: first.port } })
    running.push(proxy)
    const stale = await Bun.connect({
      hostname: '127.0.0.1',
      port: proxy.port,
      socket: { data() {} },
    })
    try {
      expect(proxy.connections()).toBe(1)
      const before = new TextEncoder().encode('ping')
      expect(await roundTrip({ port: proxy.port, bytes: before })).toEqual(
        new TextEncoder().encode('first:ping'),
      )
      proxy.retarget({ host: '127.0.0.1', port: second.port })
      const deadline = Date.now() + 3_000
      while (proxy.connections() !== 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(proxy.connections()).toBe(0)
      expect(stale.readyState).not.toBe('open')
      const after = new TextEncoder().encode('ping')
      expect(await roundTrip({ port: proxy.port, bytes: after })).toEqual(
        new TextEncoder().encode('second:ping'),
      )
    } finally {
      first.stop()
      second.stop()
      stale.end()
    }
  })

  it('stop closes the listener and every pending connection', async () => {
    const proxy = await start()
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port: proxy.port,
      socket: { data() {} },
    })
    socket.write(new TextEncoder().encode('pending'))
    const connecting = Bun.connect({
      hostname: '127.0.0.1',
      port: proxy.port,
      socket: { data() {} },
    }).catch((error: unknown) => error)
    await proxy.stop()
    expect(proxy.connections()).toBe(0)
    await connecting
    await expect(
      Bun.connect({ hostname: '127.0.0.1', port: proxy.port, socket: { data() {} } }),
    ).rejects.toThrow()
    socket.end()
  })
})
