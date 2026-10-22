import { describe, expect, it } from 'vitest'

import { CloudError } from '../cloud-transport'
import { putPodLease } from '../pod-lease-client'

type Seen = { url: string; method: string | undefined; headers: Headers; body: unknown }

const lease = async (reply: () => Response) => {
  const seen: Seen[] = []
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    seen.push({
      url: String(input),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    return reply()
  }) as typeof fetch
  const run = () =>
    putPodLease({
      url: 'https://cloud.test',
      sessionToken: 'sess_1',
      clientVersion: '1.2.3',
      threadId: 'thr/1 x',
      token: 'serve-token',
      fetchFn,
    })
  return { seen, run }
}

describe('putPodLease', () => {
  it('PUTs the serve token with the session bearer and resolves on 204', async () => {
    const { seen, run } = await lease(() => new Response(null, { status: 204 }))

    await run()

    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe('https://cloud.test/v1/pod-leases/thr%2F1%20x')
    expect(seen[0]?.method).toBe('PUT')
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer sess_1')
    expect(seen[0]?.headers.get('atlas-client-version')).toBe('1.2.3')
    expect(seen[0]?.headers.get('content-type')).toBe('application/json')
    expect(seen[0]?.body).toEqual({ token: 'serve-token' })
  })

  it('maps a 409 to the leased-elsewhere message', async () => {
    const { run } = await lease(() => Response.json({ message: 'conflict' }, { status: 409 }))

    const error: unknown = await run().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CloudError)
    expect(error).toMatchObject({
      status: 409,
      message:
        "this pod's serve token is already leased to another session — destroy the pod and start the thread again",
    })
  })

  it('surfaces a 401 as the transport reports it, without retrying', async () => {
    const { seen, run } = await lease(() =>
      Response.json({ message: 'bad session' }, { status: 401 }),
    )

    const error: unknown = await run().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CloudError)
    expect(error).toMatchObject({ status: 401 })
    expect(seen).toHaveLength(1)
  })

  it('does not retry a 503', async () => {
    const { seen, run } = await lease(() => new Response('down', { status: 503 }))

    await expect(run()).rejects.toMatchObject({ status: 503 })
    expect(seen).toHaveLength(1)
  })
})
