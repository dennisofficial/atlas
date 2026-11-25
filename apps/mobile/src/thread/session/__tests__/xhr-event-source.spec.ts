import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EReadyState, XhrEventSource, type XhrSourceEvent } from '../xhr-event-source'

class FakeRequest {
  static opened: FakeRequest[] = []
  readyState = 0
  status = 0
  responseText = ''
  withCredentials = false
  url = ''
  aborted = false
  readonly headers: Record<string, string> = {}
  onreadystatechange: (() => void) | null = null
  onerror: (() => void) | null = null

  open(_method: string, url: string): void {
    this.url = url
    this.readyState = 1
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value
  }

  send(): void {
    FakeRequest.opened.push(this)
  }

  abort(): void {
    this.aborted = true
  }

  respond(status: number): void {
    this.status = status
    this.readyState = 2
    this.onreadystatechange?.()
  }

  push(text: string): void {
    this.responseText += text
    this.readyState = 3
    this.onreadystatechange?.()
  }

  finish(): void {
    this.readyState = 4
    this.onreadystatechange?.()
  }
}

const original: unknown = Reflect.get(globalThis, 'XMLHttpRequest')

beforeEach(() => {
  FakeRequest.opened = []
  Reflect.set(globalThis, 'XMLHttpRequest', FakeRequest)
})

afterEach(() => {
  Reflect.set(globalThis, 'XMLHttpRequest', original)
})

const record = (source: XhrEventSource, types: readonly string[]): XhrSourceEvent[] => {
  const seen: XhrSourceEvent[] = []
  for (const type of types) source.addEventListener(type, (event) => seen.push(event))
  return seen
}

const latest = (): FakeRequest => {
  const request = FakeRequest.opened.at(-1)
  if (request === undefined) throw new Error('no request opened')
  return request
}

describe('XhrEventSource', () => {
  it('sends the supplied headers and parses events split across chunks', () => {
    const source = new XhrEventSource('https://api.test/v1/trpc/sessionStream.list', {
      headers: { authorization: 'Bearer secret' },
    })
    const seen = record(source, ['open', 'connected', 'message'])
    const request = latest()

    request.respond(200)
    request.push('event: connected\ndata: {"reconnectAfterInactivityMs":0}\n\nid: 7\nda')
    request.push('ta: {"type":"snapshot"}\n\n')

    expect(request.url).toBe('https://api.test/v1/trpc/sessionStream.list')
    expect(request.headers).toEqual({
      Accept: 'text/event-stream',
      'Cache-Control': 'no-store',
      authorization: 'Bearer secret',
    })
    expect(source.readyState).toBe(EReadyState.Open)
    expect(seen.map((event) => event.type)).toEqual(['open', 'connected', 'message'])
    expect(seen[2]).toEqual({ type: 'message', data: '{"type":"snapshot"}', lastEventId: '7' })
  })

  it('closes on a refused response and never reopens', async () => {
    const source = new XhrEventSource('https://api.test/stream')
    const seen = record(source, ['error'])

    latest().respond(401)
    await Bun.sleep(20)

    expect(source.readyState).toBe(EReadyState.Closed)
    expect(seen).toEqual([
      {
        type: 'error',
        error: { message: 'the stream answered 401', code: -32000, data: { httpStatus: 401 } },
      },
    ])
    expect(FakeRequest.opened).toHaveLength(1)
  })

  it('reconnects after a dropped stream with the last event id', async () => {
    const source = new XhrEventSource('https://api.test/stream')
    const seen = record(source, ['error'])
    const first = latest()

    first.respond(200)
    first.push('retry: 5\nid: 41\ndata: x\n\n')
    first.finish()

    expect(source.readyState).toBe(EReadyState.Connecting)
    expect(seen).toEqual([{ type: 'error' }])
    await Bun.sleep(30)
    expect(FakeRequest.opened).toHaveLength(2)
    expect(latest().headers['Last-Event-ID']).toBe('41')
    source.close()
  })

  it('stops delivering and aborts the request once closed', () => {
    const source = new XhrEventSource('https://api.test/stream')
    const seen = record(source, ['message', 'error'])
    const request = latest()
    request.respond(200)

    source.close()
    request.push('data: late\n\n')
    request.finish()

    expect(request.aborted).toBe(true)
    expect(source.readyState).toBe(EReadyState.Closed)
    expect(seen).toEqual([])
  })
})
