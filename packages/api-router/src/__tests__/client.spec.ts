import { describe, expect, it } from 'bun:test'
import { controlPlaneError, createApiClient, detailsOf, httpStatusOf } from '../client'

type FetchInput = Parameters<typeof fetch>[0]
type Seen = { url: string; headers: Headers; credentials: string | undefined }

const recordingFetch = (seen: Seen[]): typeof fetch =>
  Object.assign(
    async (input: FetchInput, init?: RequestInit) => {
      seen.push({
        url: String(input),
        headers: new Headers(init?.headers),
        credentials: init?.credentials,
      })
      return Response.json({ result: { data: { head: 1 } } })
    },
    { preconnect: fetch.preconnect },
  )

const failingFetch = (): typeof fetch =>
  Object.assign(
    async () =>
      Response.json(
        {
          error: {
            message: 'conflict',
            code: -32603,
            data: { code: 'CONFLICT', httpStatus: 409, details: { seq: 3 } },
          },
        },
        { status: 409 },
      ),
    { preconnect: fetch.preconnect },
  )

type FakeInit = { fetch?: (target: string | URL, init: RequestInit) => Promise<Response> }
type Constructed = { url: string; init: FakeInit | undefined }

const fakeEventSource = (constructed: Constructed[]) =>
  class FakeEventSource {
    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSED = 2
    readyState = 0

    constructor(url: string, init?: FakeInit) {
      constructed.push({ url, init })
    }

    addEventListener(): void {}
    removeEventListener(): void {}
    close(): void {}
  }

const untilConstructed = async (constructed: Constructed[]): Promise<void> => {
  const deadline = Date.now() + 1000
  while (constructed.length === 0 && Date.now() < deadline) await Bun.sleep(5)
}

describe('createApiClient', () => {
  it('sends the bearer token and client version to <baseUrl>/v1/trpc', async () => {
    const seen: Seen[] = []
    const client = createApiClient({
      baseUrl: 'https://api.atlas.test/',
      token: 'tok',
      clientVersion: '1.2.3',
      fetchFn: recordingFetch(seen),
    })

    await client.sandboxSelf.events.mutate({ events: [] }).catch(() => undefined)

    expect(seen[0]?.url).toBe('https://api.atlas.test/v1/trpc/sandboxSelf.events')
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer tok')
    expect(seen[0]?.headers.get('atlas-client-version')).toBe('1.2.3')
  })

  it('sends no authorization header without a token, and keeps same-origin credentials', async () => {
    const seen: Seen[] = []
    const client = createApiClient({ baseUrl: '', fetchFn: recordingFetch(seen) })

    await client.sandboxSelf.events.mutate({ events: [] }).catch(() => undefined)

    expect(seen[0]?.url).toBe('/v1/trpc/sandboxSelf.events')
    expect(seen[0]?.headers.has('authorization')).toBe(false)
    expect(seen[0]?.headers.has('atlas-client-version')).toBe(false)
    expect(seen[0]?.credentials).toBe('same-origin')
  })

  it('authenticates the subscription stream request through the supplied EventSource', async () => {
    const seen: Seen[] = []
    const constructed: Constructed[] = []
    const client = createApiClient({
      baseUrl: 'https://api.atlas.test',
      token: 'secret-bearer',
      clientVersion: '1.2.3',
      fetchFn: recordingFetch(seen),
      EventSource: fakeEventSource(constructed),
    })
    const subscription = client.threadEvents.stream.subscribe({ threadId: 'thr_1' }, {})

    await untilConstructed(constructed)
    const [source] = constructed
    await source?.init?.fetch?.(source.url, {
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-store' },
    })
    subscription.unsubscribe()

    expect(source?.url).toStartWith('https://api.atlas.test/v1/trpc/threadEvents.stream')
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer secret-bearer')
    expect(seen[0]?.headers.get('atlas-client-version')).toBe('1.2.3')
    expect(seen[0]?.headers.get('accept')).toBe('text/event-stream')
    expect(seen[0]?.headers.get('cache-control')).toBe('no-store')
    expect(source?.url).not.toContain('secret-bearer')
    expect(seen[0]?.url).not.toContain('secret-bearer')
  })

  it('leaves the native EventSource untouched when none is supplied', async () => {
    const constructed: Constructed[] = []
    const original: unknown = Reflect.get(globalThis, 'EventSource')
    Reflect.set(globalThis, 'EventSource', fakeEventSource(constructed))
    try {
      const client = createApiClient({ baseUrl: 'https://api.atlas.test', token: 'secret-bearer' })
      const subscription = client.threadEvents.stream.subscribe({ threadId: 'thr_1' }, {})
      await untilConstructed(constructed)
      subscription.unsubscribe()
    } finally {
      Reflect.set(globalThis, 'EventSource', original)
    }

    expect(constructed).toHaveLength(1)
    expect(constructed[0]?.init).toBeUndefined()
  })

  it('exposes the status, details and a control-plane error for a failed call', async () => {
    const client = createApiClient({ baseUrl: 'https://api.atlas.test', fetchFn: failingFetch() })

    const failure = await client.sandboxSelf.events.mutate({ events: [] }).catch((error) => error)

    expect(httpStatusOf(failure)).toBe(409)
    expect(detailsOf(failure)).toEqual({ seq: 3 })
    expect(controlPlaneError(failure).message).toBe('the control plane answered 409: conflict')
  })

  it('passes a non-tRPC failure through unchanged', () => {
    const failure = new Error('offline')

    expect(httpStatusOf(failure)).toBeUndefined()
    expect(controlPlaneError(failure)).toBe(failure)
  })
})
