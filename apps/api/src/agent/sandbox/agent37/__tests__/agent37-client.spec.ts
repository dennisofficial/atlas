import { describe, expect, it } from 'bun:test'

import { Agent37Error, liveAgent37Client } from '../agent37-client'

type Answer = { status: number; body: unknown }

const fakeFetch = (answers: Answer[]) => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
    })
    const answer = answers.shift() ?? { status: 200, body: {} }
    return new Response(JSON.stringify(answer.body), { status: answer.status })
  }) as typeof fetch
  return { fetchImpl, calls }
}

const instance = { id: 'ab12', status: 'running' as const, url: 'https://ab12.agent37.app' }

describe('liveAgent37Client', () => {
  it('creates on the API host with the key as a Bearer token', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 201, body: instance }])
    const client = liveAgent37Client({ apiKey: 'sk_live_1', fetch: fetchImpl })
    const created = await client.create({
      template: 'atlas-sandbox',
      type: 'vm',
      region: 'us',
      name: 'atlas-p1',
      metadata: { atlasPodSessionId: 'p1' },
      resources: { cpu: 2, memory: 4, disk: 20 },
      mount_path: '/atlas',
      auto_sleep: true,
      idle_timeout_seconds: 1800,
      env: {},
    })
    expect(created.id).toBe('ab12')
    expect(calls[0]?.url).toBe('https://api.agent37.com/v1/instances')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.headers.Authorization).toBe('Bearer sk_live_1')
  })

  it('execs on the sandbox host with the key as X-Agent37-Key', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { exit_code: 0, stdout: 'ok\n', stderr: '', truncated: false } },
    ])
    const client = liveAgent37Client({ apiKey: 'sk_live_2', fetch: fetchImpl })
    const answer = await client.exec({ id: 'ab12', command: 'echo ok' })
    expect(answer).toEqual({ exit_code: 0, stdout: 'ok\n', stderr: '', truncated: false })
    expect(calls[0]?.url).toBe('https://sandbox.agent37.app/v1/instances/ab12/exec')
    expect(calls[0]?.headers['X-Agent37-Key']).toBe('sk_live_2')
    expect(calls[0]?.headers.Authorization).toBeUndefined()
  })

  it('reads the flat transport error shape of sandbox.agent37.app', async () => {
    const { fetchImpl } = fakeFetch([{ status: 404, body: { error: 'not_found' } }])
    const client = liveAgent37Client({ apiKey: 'sk_live_3', fetch: fetchImpl })
    const failure = await client.exec({ id: 'ab12', command: 'true' }).catch((error) => error)
    expect(failure).toBeInstanceOf(Agent37Error)
    expect((failure as Agent37Error).code).toBe('not_found')
    expect((failure as Agent37Error).retryable).toBe(false)
  })

  it('retries a 409 try_again once and returns the answer that follows', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 409, body: { error: { code: 'try_again' } } },
      { status: 200, body: { exit_code: 0, stdout: '', stderr: '', truncated: false } },
    ])
    const client = liveAgent37Client({
      apiKey: 'sk_live_4',
      fetch: fetchImpl,
      retry: { attempts: 2, delayMs: 1 },
    })
    await client.exec({ id: 'ab12', command: 'true' })
    expect(calls).toHaveLength(2)
  })
})
