import { describe, expect, it } from 'bun:test'
import { controlPlaneError, createApiClient, detailsOf, httpStatusOf } from '../client'

type FetchInput = Parameters<typeof fetch>[0]
type Seen = {
  url: string
  headers: Headers
  credentials: string | undefined
  body: unknown
}

const wrappedBodyOf = (body: unknown): { atlasB64: string } =>
  JSON.parse(String(body)) as { atlasB64: string }

const decodedBody = (body: unknown): unknown =>
  JSON.parse(Buffer.from(wrappedBodyOf(body).atlasB64, 'base64').toString('utf8'))

const recordingFetch = (seen: Seen[]): typeof fetch =>
  Object.assign(
    async (input: FetchInput, init?: RequestInit) => {
      seen.push({
        url: String(input),
        headers: new Headers(init?.headers),
        credentials: init?.credentials,
        body: init?.body,
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

type FakeInit = {
  withCredentials?: boolean
  fetch?: (target: string | URL, init: RequestInit) => Promise<Response>
}
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

    await client.secrets.details.query().catch(() => undefined)

    expect(seen[0]?.url).toBe('https://api.atlas.test/v1/trpc/secrets.details')
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer tok')
    expect(seen[0]?.headers.get('atlas-client-version')).toBe('1.2.3')
  })

  it('sends no authorization header without a token, and keeps same-origin credentials', async () => {
    const seen: Seen[] = []
    const client = createApiClient({ baseUrl: '', fetchFn: recordingFetch(seen) })

    await client.secrets.details.query().catch(() => undefined)

    expect(seen[0]?.url).toBe('/v1/trpc/secrets.details')
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
    const subscription = client.githubPrs.states.subscribe(undefined, {})

    await untilConstructed(constructed)
    const [source] = constructed
    await source?.init?.fetch?.(source.url, {
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-store' },
    })
    subscription.unsubscribe()

    expect(source?.url).toStartWith('https://api.atlas.test/v1/trpc/githubPrs.states')
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
      const subscription = client.githubPrs.states.subscribe(undefined, {})
      await untilConstructed(constructed)
      subscription.unsubscribe()
    } finally {
      Reflect.set(globalThis, 'EventSource', original)
    }

    expect(constructed).toHaveLength(1)
    expect(constructed[0]?.init).toBeUndefined()
  })

  it('sends credentials with an include-configured call', async () => {
    const seen: Seen[] = []
    const client = createApiClient({
      baseUrl: 'https://api.atlas.test',
      credentials: 'include',
      fetchFn: recordingFetch(seen),
    })

    await client.secrets.details.query().catch(() => undefined)

    expect(seen[0]?.credentials).toBe('include')
  })

  it('lets a credentialed client send cookies with the native EventSource', async () => {
    const constructed: Constructed[] = []
    const original: unknown = Reflect.get(globalThis, 'EventSource')
    Reflect.set(globalThis, 'EventSource', fakeEventSource(constructed))
    try {
      const client = createApiClient({ baseUrl: 'https://api.atlas.test', credentials: 'include' })
      const subscription = client.githubPrs.states.subscribe(undefined, {})
      await untilConstructed(constructed)
      subscription.unsubscribe()
    } finally {
      Reflect.set(globalThis, 'EventSource', original)
    }

    expect(constructed[0]?.init).toEqual({ withCredentials: true })
  })

  it('sends credentials through a supplied EventSource', async () => {
    const seen: Seen[] = []
    const constructed: Constructed[] = []
    const client = createApiClient({
      baseUrl: 'https://api.atlas.test',
      credentials: 'include',
      fetchFn: recordingFetch(seen),
      EventSource: fakeEventSource(constructed),
    })
    const subscription = client.githubPrs.states.subscribe(undefined, {})

    await untilConstructed(constructed)
    const [source] = constructed
    await source?.init?.fetch?.(source.url, { headers: { Accept: 'text/event-stream' } })
    subscription.unsubscribe()

    expect(source?.init?.withCredentials).toBeUndefined()
    expect(seen[0]?.credentials).toBe('include')
  })

  it('exposes the status, details and a control-plane error for a failed call', async () => {
    const client = createApiClient({ baseUrl: 'https://api.atlas.test', fetchFn: failingFetch() })

    const failure = await client.secrets.details.query().catch((error) => error)

    expect(httpStatusOf(failure)).toBe(409)
    expect(detailsOf(failure)).toEqual({ seq: 3 })
    expect(controlPlaneError(failure).message).toBe('the control plane answered 409: conflict')
  })

  it('base64-wraps a mutation body', async () => {
    const seen: Seen[] = []
    const client = createApiClient({
      baseUrl: 'https://api.atlas.test',
      fetchFn: recordingFetch(seen),
    })
    const input = { sessionId: null, text: 'hello', attachments: [] }

    await client.sessionDrafts.put.mutate(input).catch(() => undefined)

    expect(Object.keys(wrappedBodyOf(seen[0]?.body))).toEqual(['atlasB64'])
    expect(decodedBody(seen[0]?.body)).toEqual(input)
  })

  it('round-trips non-ASCII and emoji text through the base64 body', async () => {
    const seen: Seen[] = []
    const client = createApiClient({
      baseUrl: 'https://api.atlas.test',
      fetchFn: recordingFetch(seen),
    })
    const input = {
      sessionId: null,
      text: 'héllo 👋 read ../../../../etc/passwd; rm -rf /tmp/x',
      attachments: [],
    }

    await client.sessionDrafts.put.mutate(input).catch(() => undefined)

    expect(decodedBody(seen[0]?.body)).toEqual(input)
  })

  it('leaves a query input in the URL and sends no body', async () => {
    const seen: Seen[] = []
    const client = createApiClient({
      baseUrl: 'https://api.atlas.test',
      fetchFn: recordingFetch(seen),
    })

    await client.sessionDrafts.get.query({ sessionId: null }).catch(() => undefined)

    expect(seen[0]?.url).toContain('input=')
    expect(seen[0]?.body).toBeUndefined()
  })

  it('passes a non-tRPC failure through unchanged', () => {
    const failure = new Error('offline')

    expect(httpStatusOf(failure)).toBeUndefined()
    expect(controlPlaneError(failure)).toBe(failure)
  })
})
