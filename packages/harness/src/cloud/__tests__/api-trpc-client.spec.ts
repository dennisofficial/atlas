import { describe, expect, it } from 'bun:test'

import {
  cloudCall,
  createHarnessApiClient,
  createRetryingFetch,
  toCloudError,
} from '../api-trpc-client'
import { CloudError, isCloudRefusal, isCloudUnavailable } from '../cloud-transport'

type Seen = { url: string; method: string; headers: Headers }

const envelope = (args: {
  status: number
  message?: string
  details?: Record<string, unknown>
  retryAfter?: string
}): Response =>
  Response.json(
    {
      error: {
        message: args.message ?? 'failed',
        code: -32603,
        data: {
          code: 'INTERNAL_SERVER_ERROR',
          httpStatus: args.status,
          ...(args.details === undefined ? {} : { details: args.details }),
        },
      },
    },
    {
      status: args.status,
      headers: args.retryAfter === undefined ? {} : { 'retry-after': args.retryAfter },
    },
  )

const success = (): Response => Response.json({ result: { data: null } })

const scripted = (replies: readonly (() => Response | Promise<Response>)[]) => {
  const seen: Seen[] = []
  const fetchFn: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seen.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
      })
      const reply = replies[Math.min(seen.length - 1, replies.length - 1)]
      if (reply === undefined) throw new Error('no reply scripted')
      return reply()
    },
    { preconnect: fetch.preconnect },
  )
  return { fetchFn, seen }
}

const instant = (delays: number[]) => async (ms: number) => {
  delays.push(ms)
}

const stopCall = (fetchFn: typeof fetch, delays: number[] = []) =>
  createHarnessApiClient({
    url: 'https://cloud.test',
    token: 'sess_test',
    clientVersion: '1.2.3',
    fetchFn,
    sleep: instant(delays),
    randomFn: () => 1,
  }).sandboxSelf.stop.mutate({})

const rejection = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (failure: unknown) => failure,
  )

describe('createRetryingFetch', () => {
  it('retries a 429 query with the existing backoff and honours retry-after', async () => {
    const delays: number[] = []
    const { fetchFn, seen } = scripted([
      () => envelope({ status: 429, retryAfter: '2' }),
      () => envelope({ status: 429 }),
      success,
    ])
    const retrying = createRetryingFetch({
      fetchFn,
      sleep: instant(delays),
      randomFn: () => 0.5,
    })

    const response = await retrying('https://cloud.test/v1/trpc/threads.list', { method: 'GET' })

    expect(response.status).toBe(200)
    expect(seen.map((call) => call.method)).toEqual(['GET', 'GET', 'GET'])
    expect(delays).toEqual([2000, 500])
  })

  it('gives up on a query after the default attempts and returns the last answer', async () => {
    const { fetchFn, seen } = scripted([() => envelope({ status: 503 })])
    const retrying = createRetryingFetch({ fetchFn, sleep: instant([]), randomFn: () => 0 })

    const response = await retrying('https://cloud.test/v1/trpc/threads.list')

    expect(response.status).toBe(503)
    expect(seen).toHaveLength(4)
  })

  it('retries a network error on a query', async () => {
    const { fetchFn, seen } = scripted([
      () => {
        throw new Error('the connection was reset')
      },
      success,
    ])
    const retrying = createRetryingFetch({ fetchFn, sleep: instant([]), randomFn: () => 0 })

    const response = await retrying('https://cloud.test/v1/trpc/threads.list')

    expect(response.status).toBe(200)
    expect(seen).toHaveLength(2)
  })

  it('aborts a stalled query attempt at the timeout and retries it', async () => {
    const stalled = (): Promise<Response> => new Promise(() => undefined)
    const { fetchFn, seen } = scripted([stalled, success])
    const withSignal: typeof fetch = Object.assign(
      (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        init?.signal === undefined || init.signal === null
          ? fetchFn(input, init)
          : Promise.race([
              fetchFn(input, init),
              new Promise<Response>((_resolve, reject) => {
                init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
              }),
            ]),
      { preconnect: fetch.preconnect },
    )
    const retrying = createRetryingFetch({
      fetchFn: withSignal,
      sleep: instant([]),
      randomFn: () => 0,
      timeoutMs: 20,
    })

    const response = await retrying('https://cloud.test/v1/trpc/threads.list')

    expect(response.status).toBe(200)
    expect(seen).toHaveLength(2)
  })

  it('does not set a signal when the timeout is null', async () => {
    let signal: AbortSignal | null | undefined
    const fetchFn: typeof fetch = Object.assign(
      async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        signal = init?.signal
        return success()
      },
      { preconnect: fetch.preconnect },
    )

    await createRetryingFetch({ fetchFn, timeoutMs: null })('https://cloud.test/v1/trpc/x')

    expect(signal).toBeUndefined()
  })

  it('wraps a non-tRPC error body in an envelope carrying the http status', async () => {
    const { fetchFn } = scripted([() => new Response('<html>bad gateway</html>', { status: 502 })])
    const retrying = createRetryingFetch({ fetchFn, sleep: instant([]) })

    const response = await retrying('https://cloud.test/v1/trpc/x', { method: 'POST' })
    const body: unknown = await response.json()

    expect(response.status).toBe(502)
    expect(body).toMatchObject({ error: { data: { httpStatus: 502 } } })
  })
})

describe('createHarnessApiClient', () => {
  it('sends the bearer token and client version, and posts mutations', async () => {
    const { fetchFn, seen } = scripted([success])

    await stopCall(fetchFn)

    expect(seen[0]?.url).toBe('https://cloud.test/v1/trpc/sandboxSelf.stop')
    expect(seen[0]?.method).toBe('POST')
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer sess_test')
    expect(seen[0]?.headers.get('atlas-client-version')).toBe('1.2.3')
  })

  it('does not retry a mutation, even on a 429', async () => {
    const delays: number[] = []
    const { fetchFn, seen } = scripted([() => envelope({ status: 429 }), success])

    const failure = await rejection(cloudCall(stopCall(fetchFn, delays)))

    expect(seen).toHaveLength(1)
    expect(delays).toEqual([])
    expect(failure).toMatchObject({ status: 429 })
  })

  it('does not retry a mutation after a network error and reports status 0', async () => {
    const { fetchFn, seen } = scripted([
      () => {
        throw new Error('the connection was reset')
      },
    ])

    const failure = await rejection(cloudCall(stopCall(fetchFn)))

    expect(seen).toHaveLength(1)
    expect(failure).toBeInstanceOf(CloudError)
    expect(failure).toMatchObject({ status: 0 })
    expect(isCloudUnavailable(failure)).toBe(true)
  })

  it('times out a stalled mutation and reports it as unreachable', async () => {
    const { fetchFn } = scripted([() => new Promise(() => undefined)])
    const client = createHarnessApiClient({
      url: 'https://cloud.test',
      token: 'sess_test',
      clientVersion: '1.2.3',
      fetchFn: Object.assign(
        (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
          Promise.race([
            fetchFn(input, init),
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
            }),
          ]),
        { preconnect: fetch.preconnect },
      ),
      timeoutMs: 20,
    })

    const failure = await rejection(cloudCall(client.sandboxSelf.stop.mutate({})))

    expect(failure).toMatchObject({ status: 0 })
  })
})

describe('createHarnessApiClient subscriptions', () => {
  it('sends the bearer on the stream request through a supplied EventSource', async () => {
    const { fetchFn, seen } = scripted([success])
    const constructed: Array<{
      url: string
      init?: { fetch?: (target: string | URL, init?: RequestInit) => Promise<Response> } | undefined
    }> = []
    class FakeEventSource {
      readonly CONNECTING = 0
      readonly OPEN = 1
      readonly CLOSED = 2
      readyState = 0
      constructor(url: string, init?: (typeof constructed)[number]['init'] | undefined) {
        constructed.push({ url, init })
      }
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {}
    }
    const client = createHarnessApiClient({
      url: 'https://cloud.test',
      token: 'sess_test',
      clientVersion: '1.2.3',
      fetchFn,
      EventSource: FakeEventSource,
    })

    const subscription = client.threadEvents.stream.subscribe({ threadId: 'thr_1' }, {})
    const deadline = Date.now() + 1000
    while (constructed.length === 0 && Date.now() < deadline) await Bun.sleep(5)
    await constructed[0]?.init?.fetch?.(constructed[0].url, { headers: {} })
    subscription.unsubscribe()

    expect(constructed[0]?.url).toStartWith('https://cloud.test/v1/trpc/threadEvents.stream')
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer sess_test')
  })
})

describe('cloudCall', () => {
  it('returns undefined on a 404 when allowMissing is set', async () => {
    const { fetchFn } = scripted([() => envelope({ status: 404, message: 'NOT_FOUND' })])

    expect(await cloudCall(stopCall(fetchFn), { allowMissing: true })).toBeUndefined()
  })

  it('throws a 404 as CloudError without allowMissing', async () => {
    const { fetchFn } = scripted([() => envelope({ status: 404, message: 'NOT_FOUND' })])

    const failure = await rejection(cloudCall(stopCall(fetchFn)))

    expect(failure).toBeInstanceOf(CloudError)
    expect(failure).toMatchObject({ status: 404 })
  })

  it('maps a 401 to a CloudError that isCloudRefusal recognises', async () => {
    const { fetchFn } = scripted([() => envelope({ status: 401, message: 'UNAUTHORIZED' })])

    const failure = await rejection(cloudCall(stopCall(fetchFn)))

    expect(failure).toBeInstanceOf(CloudError)
    expect(isCloudRefusal(failure)).toBe(true)
    expect(isCloudUnavailable(failure)).toBe(false)
  })

  it('carries details.code through to CloudError.code', async () => {
    const { fetchFn } = scripted([
      () => envelope({ status: 409, details: { code: 'LEASED_ELSEWHERE', seq: 3 } }),
    ])

    const failure = await rejection(cloudCall(stopCall(fetchFn)))

    expect(failure).toMatchObject({ status: 409, code: 'LEASED_ELSEWHERE' })
  })

  it('marks a 5xx as unavailable', async () => {
    const { fetchFn } = scripted([() => envelope({ status: 503 })])

    expect(isCloudUnavailable(await rejection(cloudCall(stopCall(fetchFn))))).toBe(true)
  })

  it('passes an existing CloudError through toCloudError unchanged', () => {
    const original = new CloudError({ status: 409, message: 'leased' })

    expect(toCloudError(original)).toBe(original)
  })
})
