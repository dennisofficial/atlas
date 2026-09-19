import { describe, expect, it } from 'bun:test'

import { CloudError, cloudRequest } from '../cloud-transport'

const harness = (args: { replies: readonly { status: number; body?: unknown; retryAfter?: string }[] }) => {
  const calls: string[] = []
  const delays: number[] = []
  let at = 0

  const fetchFn = (async (input: unknown) => {
    calls.push(String(input))
    const reply = args.replies[Math.min(at, args.replies.length - 1)]
    at += 1
    return new Response(reply?.body === undefined ? '' : JSON.stringify(reply.body), {
      status: reply?.status ?? 200,
      headers: reply?.retryAfter === undefined ? {} : { 'retry-after': reply.retryAfter },
    })
  }) as typeof fetch

  const sleep = async (ms: number): Promise<void> => {
    delays.push(ms)
  }

  const request = () =>
    cloudRequest({
      url: 'https://cloud.test',
      token: 'sess_test',
      clientVersion: '1.2.3',
      fetchFn,
      method: 'GET',
      path: '/v1/threads/thread-1/events',
      sleep,
    })

  return { request, calls, delays }
}

describe('cloudRequest against a throttled API', () => {
  it('retries a 429 and returns the answer that eventually lands', async () => {
    const { request, calls } = harness({
      replies: [
        { status: 429, body: { message: 'ThrottlerException: Too Many Requests' } },
        { status: 429, body: { message: 'ThrottlerException: Too Many Requests' } },
        { status: 200, body: [{ id: 'event-1' }] },
      ],
    })

    expect(await request()).toEqual([{ id: 'event-1' }])
    expect(calls).toHaveLength(3)
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

    await request()
    expect(delays).toEqual([1000, 5000, 4000])
  })

  it('gives up after the retries and throws the 429 it last heard', async () => {
    const { request, calls } = harness({
      replies: [{ status: 429, body: { message: 'ThrottlerException: Too Many Requests' } }],
    })

    const failure = await request().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(429)
    expect((failure as CloudError).message).toContain('ThrottlerException: Too Many Requests')
    expect(calls).toHaveLength(4)
  })

  it('never retries a failure that is not a throttle', async () => {
    const { request, calls, delays } = harness({
      replies: [{ status: 400, body: { message: 'bad request' } }],
    })

    const failure = await request().catch((error: unknown) => error)
    expect((failure as CloudError).status).toBe(400)
    expect(calls).toHaveLength(1)
    expect(delays).toEqual([])
  })
})
