import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

import type { XhrEventSource as EventSource, XhrSourceEvent } from '../xhr-event-source'

class FakeRequest {
  static opened: FakeRequest[] = []
  readonly url: string
  readonly init: RequestInit
  private readonly resolve: (response: Response) => void
  private readonly reject: (error: Error) => void
  readonly response: Promise<Response>
  private controller: ReadableStreamDefaultController<Uint8Array> | undefined
  cancelled = false

  constructor({ url, init }: { url: string; init: RequestInit }) {
    this.url = url
    this.init = init
    const pending = Promise.withResolvers<Response>()
    this.response = pending.promise
    this.resolve = pending.resolve
    this.reject = pending.reject
    init.signal?.addEventListener('abort', () => {
      this.reject(new Error('aborted'))
      if (!this.cancelled) this.controller?.error(new Error('aborted'))
    })
    FakeRequest.opened.push(this)
  }

  respond(status = 200): void {
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller
      },
      cancel: () => {
        this.cancelled = true
      },
    })
    this.resolve(new Response(body, { status }))
  }

  push(text: string | Uint8Array): void {
    this.controller?.enqueue(typeof text === 'string' ? new TextEncoder().encode(text) : text)
  }

  finish(): void {
    this.controller?.close()
  }

  fail(): void {
    this.reject(new Error('network failed'))
    this.controller?.error(new Error('network failed'))
  }
}

mock.module('expo/fetch', () => ({
  fetch: (url: string, init: RequestInit) => new FakeRequest({ url, init }).response,
}))

const { EReadyState, XhrEventSource } = await import('../xhr-event-source')

const sources: EventSource[] = []
const createSource = (init?: ConstructorParameters<typeof XhrEventSource>[1]): EventSource => {
  const source = new XhrEventSource('https://api.test/stream', init)
  sources.push(source)
  return source
}
const flush = async (): Promise<void> => {
  for (let tick = 0; tick < 8; tick++) await Promise.resolve()
}
const record = ({ source, types }: { source: EventSource; types: string[] }): XhrSourceEvent[] => {
  const seen: XhrSourceEvent[] = []
  for (const type of types) source.addEventListener(type, (event) => seen.push(event))
  return seen
}
const latest = (): FakeRequest => {
  const request = FakeRequest.opened.at(-1)
  if (request === undefined) throw new Error('no request opened')
  return request
}

beforeEach(() => {
  FakeRequest.opened = []
})
afterEach(() => {
  for (const source of sources.splice(0)) source.close()
  mock.restore()
})

describe('XhrEventSource', () => {
  it('sends headers and credentials and parses split events', async () => {
    const source = createSource({
      headers: { authorization: 'Bearer secret' },
      credentials: 'include',
    })
    const seen = record({ source, types: ['open', 'connected', 'message'] })
    const request = latest()
    request.respond()
    request.push('event: connected\ndata: {"reconnectAfterInactivityMs":0}\n\nid: 7\nda')
    request.push('ta: {"type":"snapshot"}\n\n')
    await flush()

    expect(request.url).toBe('https://api.test/stream')
    expect(request.init.headers).toEqual({
      Accept: 'text/event-stream',
      'Cache-Control': 'no-store',
      authorization: 'Bearer secret',
    })
    expect(request.init.credentials).toBe('include')
    expect(source.readyState).toBe(EReadyState.Open)
    expect([source.CONNECTING, source.OPEN, source.CLOSED]).toEqual([0, 1, 2])
    expect(seen.map((event) => event.type)).toEqual(['open', 'connected', 'message'])
    expect(seen[2]).toEqual({ type: 'message', data: '{"type":"snapshot"}', lastEventId: '7' })
  })

  it('closes on a refused response and never reopens', async () => {
    const source = createSource()
    const seen = record({ source, types: ['error'] })
    latest().respond(401)
    await flush()
    expect(source.readyState).toBe(EReadyState.Closed)
    expect(seen).toEqual([
      {
        type: 'error',
        error: { message: 'the stream answered 401', code: -32000, data: { httpStatus: 401 } },
      },
    ])
    expect(FakeRequest.opened).toHaveLength(1)
    expect(latest().init.signal?.aborted).toBe(true)
  })

  it('reconnects with the last complete event id and resets partial data', async () => {
    const source = createSource()
    const seen = record({ source, types: ['error', 'message'] })
    const first = latest()
    first.respond()
    first.push('retry: 1\nid: 41\ndata: x\n\nid: 42\ndata: partial')
    await flush()
    first.finish()
    await flush()
    expect(source.readyState).toBe(EReadyState.Connecting)
    expect(seen.at(-1)).toEqual({ type: 'error' })
    await Bun.sleep(10)
    expect(FakeRequest.opened).toHaveLength(2)
    expect(latest().init.headers).toHaveProperty('Last-Event-ID', '41')
    latest().respond()
    latest().push('data: next\n\n')
    await flush()
    expect(seen.at(-1)).toEqual({ type: 'message', data: 'next', lastEventId: '41' })
  })

  it('aborts a pending fetch when closed and ignores its late response', async () => {
    const source = createSource()
    const seen = record({ source, types: ['open', 'message', 'error'] })
    const request = latest()
    source.close()
    request.respond()
    await flush()
    expect(request.init.signal?.aborted).toBe(true)
    expect(source.readyState).toBe(EReadyState.Closed)
    expect(seen).toEqual([])
  })

  it('stops delivery within a chunk and removes listeners', async () => {
    const source = createSource()
    const seen = record({ source, types: ['error'] })
    const removed = (event: XhrSourceEvent) => seen.push(event)
    source.addEventListener('message', removed)
    source.removeEventListener('message', removed)
    source.addEventListener('message', () => source.close())
    latest().respond()
    latest().push('data: first\n\ndata: late\n\n')
    await flush()
    expect(source.readyState).toBe(EReadyState.Closed)
    expect(latest().init.signal?.aborted).toBe(true)
    expect(seen).toEqual([])
  })

  it('emits an error on fetch and body failures', async () => {
    for (const opened of [false, true]) {
      const source = createSource()
      const seen = record({ source, types: ['error'] })
      if (opened) latest().respond()
      await flush()
      latest().fail()
      await flush()
      expect(seen).toEqual([{ type: 'error' }])
      expect(source.readyState).toBe(EReadyState.Connecting)
      source.close()
    }
  })

  it('decodes UTF-8 split across reads', async () => {
    const source = createSource()
    const seen = record({ source, types: ['message'] })
    latest().respond()
    const encoded = new TextEncoder().encode('data: 🦆 café\n\n')
    for (const byte of encoded) {
      latest().push(new Uint8Array([byte]))
      await flush()
    }
    expect(seen[0]?.data).toBe('🦆 café')
  })

  it('reads more than 300 MB on one connection without retaining the response or oversized decode buffers', async () => {
    const source = createSource()
    const decode = spyOn(TextDecoder.prototype, 'decode')
    let delivered = 0
    source.addEventListener('message', () => delivered++)
    latest().respond()
    const chunk = new TextEncoder().encode(`data: ${'x'.repeat(65536)}\n\n`)
    for (let index = 0; index < 4800; index++) {
      latest().push(chunk)
      await flush()
      expect(decode.mock.calls.every(([input]) => (input?.byteLength ?? 0) <= 16384)).toBe(true)
      decode.mockClear()
    }
    expect(delivered).toBe(4800)
    expect(FakeRequest.opened).toHaveLength(1)
    expect(source.readyState).toBe(EReadyState.Open)
  }, 30000)

  for (const terminator of ['\n', '\r', '\r\n']) {
    it(`bounds frames with ${JSON.stringify(terminator)} delimiters and reconnects after an oversized frame`, async () => {
      const source = createSource()
      const seen = record({ source, types: ['error', 'message'] })
      const request = latest()
      request.respond()
      request.push(`retry: 1${terminator}id: 9${terminator}data: ok${terminator}${terminator}`)
      await flush()
      const line = `data: ${'x'.repeat(65536)}${terminator}`
      for (let index = 0; index < 65 && !request.init.signal?.aborted; index++) {
        request.push(line)
        await flush()
      }
      expect(request.init.signal?.aborted).toBe(true)
      expect(seen.map((event) => event.type)).toEqual(['message', 'error'])
      await Bun.sleep(10)
      expect(latest().init.headers).toHaveProperty('Last-Event-ID', '9')
      latest().respond()
      latest().push('data: recovered\n\n')
      await flush()
      expect(seen.at(-1)?.data).toBe('recovered')
    })
  }

  it('does not reconnect when an error listener closes the source', async () => {
    const source = createSource()
    source.addEventListener('error', () => source.close())
    latest().respond()
    latest().push('retry: 1\n\n')
    await flush()
    latest().finish()
    await flush()
    await Bun.sleep(10)
    expect(source.readyState).toBe(EReadyState.Closed)
    expect(FakeRequest.opened).toHaveLength(1)
  })

  it('handles CRLF and frame boundaries split across individual bytes', async () => {
    const source = createSource()
    const seen = record({ source, types: ['message'] })
    latest().respond()
    for (const byte of new TextEncoder().encode('id: 5\r\ndata: one\r\n\r\ndata: two\r\n\r\n')) {
      latest().push(new Uint8Array([byte]))
      await flush()
    }
    expect(seen.map((event) => event.data)).toEqual(['one', 'two'])
  })

  it('rejects a single huge complete event without delivering it', async () => {
    const source = createSource()
    const seen = record({ source, types: ['message', 'error'] })
    latest().respond()
    latest().push(`data: ${'x'.repeat(4 * 1024 * 1024)}\n\n`)
    await flush()
    expect(seen).toEqual([{ type: 'error' }])
    expect(latest().init.signal?.aborted).toBe(true)
  })
})
