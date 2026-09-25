import { describe, expect, it } from 'bun:test'

import { CloudError, cloudRequest } from '../cloud-transport'

type Reply = { status: number; body?: unknown; retryAfter?: string; networkError?: boolean }

const harness = (args: { replies: readonly Reply[] }) => {
  const calls: string[] = []
  const delays: number[] = []
  let at = 0

  const fetchFn = (async (input: unknown) => {
    calls.push(String(input))
    const reply = args.replies[Math.min(at, args.replies.length - 1)]
    at += 1
    if (reply?.networkError === true) throw new Error('the connection was reset')
    return new Response(reply?.body === undefined ? '' : JSON.stringify(reply.body), {
      status: reply?.status ?? 200,
      headers: reply?.retryAfter === undefined ? {} : { 'retry-after': reply.retryAfter },
    })
  }) as typeof fetch

  const sleep = async (ms: number): Promise<void> => {
    delays.push(ms)
  }

  const request = (overrides?: { retry?: boolean; randomFn?: () => number }) =>
    cloudRequest({
      url: 'https://cloud.test',
      token: 'sess_test',
      clientVersion: '1.2.3',
      fetchFn,
      method: 'GET',
      path: '/v1/threads/thread-1/events',
      sleep,
      ...overrides,
    })

  return { request, calls, delays }
}

describe('cloudRequest with retry opted in', () => {
  it('retries a 429 and returns the answer that eventually lands', async () => {
    const { request, calls } = harness({
      replies: [
        { status: 429, body: { message: 'ThrottlerException: Too Many Requests' } },
        { status: 429, body: { message: 'ThrottlerException: Too Many Requests' } },
        { status: 200, body: [{ id: 'event-1' }] },
      ],
    })

    expect(await request({ retry: true })).toEqual([{ id: 'event-1' }])
    expect(calls).toHaveLength(3)
  })

  it('retries a 5xx the same as a 429', async () => {
    const { request, calls } = harness({
      replies: [{ status: 503 }, { status: 200, body: [] }],
    })

    expect(await request({ retry: true })).toEqual([])
    expect(calls).toHaveLength(2)
  })

  it('retries a fetch-level network failure', async () => {
    const { request, calls } = harness({
      replies: [{ status: 200, networkError: true }, { status: 200, body: [] }],
    })

    expect(await request({ retry: true })).toEqual([])
    expect(calls).toHaveLength(2)
  })

  it('backs off exponentially, preferring the retry-after header when one is sent', async () => {
    const { request, delays } = harness({
      replies: [
        { status: 429 },
        { status: 429, retryAfter: '5' },
        { status: 429 },
        { status: 200, body: [] },
      ],
    })

    await request({ retry: true, randomFn: () => 1 })
    expect(delays).toEqual([500, 5000, 2000])
  })

  it('gives up after the retries and throws the 429 it last heard', async () => {
    const { request, calls } = harness({
      replies: [{ status: 429, body: { message: 'ThrottlerException: Too Many Requests' } }],
    })

    const failure = await request({ retry: true }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(429)
    expect((failure as CloudError).message).toContain('ThrottlerException: Too Many Requests')
    expect(calls).toHaveLength(4)
  })

  it('gives up after the retries and throws the network failure it last heard', async () => {
    const { request, calls } = harness({ replies: [{ status: 200, networkError: true }] })

    const failure = await request({ retry: true }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(0)
    expect(calls).toHaveLength(4)
  })

  it('never retries a failure that is not a throttle or a reset', async () => {
    const { request, calls, delays } = harness({
      replies: [{ status: 400, body: { message: 'bad request' } }],
    })

    const failure = await request({ retry: true }).catch((error: unknown) => error)
    expect((failure as CloudError).status).toBe(400)
    expect(calls).toHaveLength(1)
    expect(delays).toEqual([])
  })

  it('aborts a wedged request at the timeout instead of hanging on the proxy, then retries', async () => {
    // A crash-looping origin holds the connection open with no bytes until the proxy 504s at ~60s.
    // The per-attempt abort must turn that hang into a fast failure the retry can recover from.
    let at = 0
    const calls: number[] = []
    const fetchFn = (async (_input: unknown, init?: RequestInit) => {
      at += 1
      calls.push(at)
      if (at === 1) {
        return await new Promise<Response>((resolve, reject) => {
          const signal = init?.signal
          if (signal === null || signal === undefined) {
            resolve(new Response('', { status: 200 }))
            return
          }
          if (signal.aborted) {
            reject(new DOMException('The operation timed out.', 'TimeoutError'))
            return
          }
          signal.addEventListener('abort', () =>
            reject(new DOMException('The operation timed out.', 'TimeoutError')),
          )
        })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }) as typeof fetch

    const startedAt = Date.now()
    const answer = await cloudRequest({
      url: 'https://cloud.test',
      token: 'sess_test',
      clientVersion: '1.2.3',
      fetchFn,
      method: 'GET',
      path: '/v1/threads/thread-1/events',
      retry: true,
      timeoutMs: 25,
      sleep: () => Promise.resolve(),
      randomFn: () => 1,
    })

    expect(answer).toEqual([])
    expect(calls).toHaveLength(2)
    expect(Date.now() - startedAt).toBeLessThan(1000)
  })
})

describe('cloudRequest without retry (the mutation default)', () => {
  it('throws on the first 429 rather than retrying', async () => {
    const { request, calls } = harness({
      replies: [{ status: 429, body: { message: 'ThrottlerException: Too Many Requests' } }],
    })

    const failure = await request().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(429)
    expect(calls).toHaveLength(1)
  })

  it('throws on the first network failure rather than retrying', async () => {
    const { request, calls } = harness({ replies: [{ status: 200, networkError: true }] })

    const failure = await request().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(0)
    expect(calls).toHaveLength(1)
  })
})
