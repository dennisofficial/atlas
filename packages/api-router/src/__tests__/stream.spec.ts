import { beforeEach, describe, expect, it } from 'bun:test'
import {
  EStreamCacheOutcome,
  EStreamSurface,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'
import { createApiClient } from '../client'
import { sessionStreamTransport, type SessionStreamHandlers } from '../stream'

type MessageEvent = { data: string; lastEventId?: string }
type Listener = (event: MessageEvent) => void

class FakeEventSource {
  static latest: FakeEventSource | undefined

  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSED = 2
  readyState = 1
  private readonly listeners = new Map<string, Listener[]>()

  constructor(readonly url: string) {
    FakeEventSource.latest = this
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((one) => one !== listener),
    )
  }

  close(): void {
    this.readyState = this.CLOSED
  }

  emit(type: string, event: MessageEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

const transportOf = (handleUnauthorized?: () => void) =>
  sessionStreamTransport({
    client: createApiClient({ baseUrl: 'https://api.atlas.test', EventSource: FakeEventSource }),
    handleUnauthorized,
  })

type Collected = {
  handlers: SessionStreamHandlers
  frames: StreamServerMessage[]
  failures: (number | undefined)[]
  ends: number
}

const collected = (): Collected => {
  const state: Collected = {
    handlers: {
      handleFrame: (frame) => state.frames.push(frame),
      handleFailure: (status) => state.failures.push(status),
      handleEnd: () => (state.ends += 1),
    },
    frames: [],
    failures: [],
    ends: 0,
  }
  return state
}

const opened = async (): Promise<FakeEventSource> => {
  const deadline = Date.now() + 2000
  while (FakeEventSource.latest === undefined && Date.now() < deadline) await Bun.sleep(5)
  const source = FakeEventSource.latest
  if (source === undefined) throw new Error('the subscription never opened an event source')
  return source
}

const settled = async (done: () => boolean): Promise<void> => {
  const deadline = Date.now() + 2000
  while (!done() && Date.now() < deadline) await Bun.sleep(5)
}

const deliver = (source: FakeEventSource, value: unknown): void =>
  source.emit('message', { data: JSON.stringify(value) })

describe('sessionStreamTransport', () => {
  beforeEach(() => {
    FakeEventSource.latest = undefined
  })

  it('delivers the frames the wire schema accepts and drops the rest', async () => {
    const state = collected()
    const subscription = transportOf().follow({ sessionId: 'ses_1', afterSeq: 3 }, state.handlers)
    const source = await opened()

    deliver(source, { type: 'pong' })
    deliver(source, { type: 'ready' })
    deliver(source, { type: 'ready', v: 1, connectionId: 'conn_1' })
    await settled(() => state.frames.length === 2)
    subscription.close()

    expect(source.url).toStartWith('https://api.atlas.test/v1/trpc/sessionStream.follow')
    expect(state.frames).toEqual([
      { type: 'pong' },
      { type: 'ready', v: 1, connectionId: 'conn_1' },
    ])
    expect(source.readyState).toBe(source.CLOSED)
  })

  it('declares its surface on every follow', async () => {
    const transport = sessionStreamTransport({
      client: createApiClient({ baseUrl: 'https://api.atlas.test', EventSource: FakeEventSource }),
      surface: EStreamSurface.Desktop,
    })
    const subscription = transport.follow(
      { sessionId: 'ses_1', cache: EStreamCacheOutcome.Restored, hydrateMs: 225 },
      collected().handlers,
    )
    const source = await opened()
    subscription.close()

    const input = new URL(source.url).searchParams.get('input') ?? ''
    expect(JSON.parse(input)).toEqual({
      sessionId: 'ses_1',
      surface: 'desktop',
      cache: 'restored',
      hydrateMs: 225,
    })
  })

  it('follows the whole user stream without an input', async () => {
    const state = collected()
    const subscription = transportOf().list(state.handlers)
    const source = await opened()

    deliver(source, { type: 'pong' })
    await settled(() => state.frames.length === 1)
    subscription.close()

    expect(source.url).toStartWith('https://api.atlas.test/v1/trpc/sessionStream.list')
    expect(state.frames).toEqual([{ type: 'pong' }])
  })

  it('reports a failed stream and signs out when the control plane answers 401', async () => {
    let signedOut = 0
    const state = collected()
    const subscription = transportOf(() => (signedOut += 1)).follow(
      { sessionId: 'ses_1' },
      state.handlers,
    )
    const source = await opened()

    source.emit('serialized-error', {
      data: JSON.stringify({
        message: 'unauthorized',
        code: -32001,
        data: { code: 'UNAUTHORIZED', httpStatus: 401 },
      }),
    })
    await settled(() => state.failures.length === 1)
    subscription.close()

    expect(state.failures).toEqual([401])
    expect(signedOut).toBe(1)
  })

  it('reports one failure when the link drops and would reconnect with the stale input', async () => {
    const state = collected()
    const subscription = transportOf().follow({ sessionId: 'ses_1', afterSeq: 3 }, state.handlers)
    const source = await opened()

    source.emit('error', { data: '' })
    await settled(() => state.failures.length >= 1)
    await Bun.sleep(20)
    subscription.close()

    expect(state.failures).toEqual([undefined])
    expect(state.ends).toBe(0)
    expect(source.readyState).toBe(source.CLOSED)
  })

  it('ends once when the server stops the stream', async () => {
    const state = collected()
    const transport = transportOf()
    transport.list(state.handlers)
    const source = await opened()

    source.emit('return', { data: '' })
    await settled(() => state.ends === 1)

    expect(state.ends).toBe(1)
  })
})
