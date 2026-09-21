import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { createHeartbeat } from '../heartbeat'

const threadId = toThreadId('thread-heartbeat')

const recorder = () => {
  const calls: { url: string; authorization: string | null; method: string }[] = []

  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({
      url: String(input),
      authorization: headers.get('authorization'),
      method: init?.method ?? 'GET',
    })
    return new Response(null, { status: 204 })
  }) as typeof fetch

  return { calls, fetchFn }
}

describe('createHeartbeat', () => {
  it('posts to the thread endpoint with the session token when a turn starts', async () => {
    const { calls, fetchFn } = recorder()
    const heartbeat = createHeartbeat({
      controlPlaneUrl: 'https://api.example.com/',
      threadId,
      token: 'secret',
      fetchFn,
    })

    heartbeat.turnStarted()
    heartbeat.turnEnded()
    await Bun.sleep(1)

    expect(calls).toEqual([
      {
        url: 'https://api.example.com/v1/sandboxes/thread-heartbeat/heartbeat',
        authorization: 'Bearer secret',
        method: 'POST',
      },
    ])
  })

  it('keeps beating while the turn runs and stops when it ends', async () => {
    const { calls, fetchFn } = recorder()
    const heartbeat = createHeartbeat({
      controlPlaneUrl: 'https://api.example.com',
      threadId,
      token: 'secret',
      fetchFn,
      intervalMs: 5,
    })

    heartbeat.turnStarted()
    await Bun.sleep(28)
    const during = calls.length
    heartbeat.turnEnded()
    await Bun.sleep(20)

    expect(during).toBeGreaterThan(1)
    expect(calls.length).toBe(during)
    heartbeat.stop()
  })

  it('beats once for a burst of activity outside a turn', async () => {
    const { calls, fetchFn } = recorder()
    const heartbeat = createHeartbeat({
      controlPlaneUrl: 'https://api.example.com',
      threadId,
      token: 'secret',
      fetchFn,
    })

    heartbeat.beat()
    await Bun.sleep(1)
    heartbeat.stop()

    expect(calls.length).toBe(1)
  })

  it('reports a control plane that refuses rather than throwing at the caller', async () => {
    const refusals: string[] = []
    const heartbeat = createHeartbeat({
      controlPlaneUrl: 'https://api.example.com',
      threadId,
      token: 'secret',
      fetchFn: (async (input: unknown) =>
        new Response(String(input), { status: 401 })) as typeof fetch,
      onFailure: (reason) => refusals.push(reason),
    })

    heartbeat.beat()
    await Bun.sleep(1)
    heartbeat.stop()

    expect(refusals).toEqual([
      'The Atlas Cloud API answered POST /v1/sandboxes/thread-heartbeat/heartbeat with 401.',
    ])
  })

  it('retries a throttled beat instead of reporting it as a failure', async () => {
    const refusals: string[] = []
    const delays: number[] = []
    let at = 0
    const fetchFn = (async (_input: unknown) => {
      at += 1
      return new Response(null, { status: at === 1 ? 429 : 204 })
    }) as typeof fetch

    const heartbeat = createHeartbeat({
      controlPlaneUrl: 'https://api.example.com',
      threadId,
      token: 'secret',
      fetchFn,
      sleep: async (ms) => void delays.push(ms),
      onFailure: (reason) => refusals.push(reason),
    })

    heartbeat.beat()
    await Bun.sleep(1)
    heartbeat.stop()

    expect(at).toBe(2)
    expect(delays).toHaveLength(1)
    expect(refusals).toEqual([])
  })
})
