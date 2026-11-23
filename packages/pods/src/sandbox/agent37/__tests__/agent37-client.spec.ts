import { describe, expect, it } from 'bun:test'

import { Agent37Error, liveAgent37Client } from '../agent37-client'

type Answer = { status: number; body: unknown }

const fakeFetch = (answers: Answer[]) => {
  const calls: Array<{
    url: string
    method: string
    headers: Record<string, string>
    body: unknown
  }> = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    const answer = answers.shift() ?? { status: 200, body: {} }
    return new Response(JSON.stringify(answer.body), { status: answer.status })
  }) as typeof fetch
  return { fetchImpl, calls }
}

const instance = { id: 'ab12', status: 'running' as const, url: 'https://ab12.agent37.app' }

const createArgs = {
  template: 'atlas-sandbox',
  type: 'vm' as const,
  region: 'us' as const,
  name: 'atlas-p1',
  metadata: { atlasPodSessionId: 'p1' },
  resources: { cpu: 2, memory: 4, disk: 20 },
  mount_path: '/atlas',
  auto_sleep: true,
  idle_timeout_seconds: 1800,
  env: {},
}

describe('liveAgent37Client', () => {
  it('creates on the API host with the key as a Bearer token', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 201, body: instance }])
    const client = liveAgent37Client({ apiKey: 'sk_live_1', fetch: fetchImpl })
    const created = await client.create(createArgs)
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

  it('resizes on the API host, sending only the dimensions it was given', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { ...instance, resources: { cpu: 4, memory: 8, disk: 20 } } },
    ])
    const client = liveAgent37Client({ apiKey: 'sk_live_5', fetch: fetchImpl })
    const resized = await client.resize({ id: 'ab12', cpu: 4, memory: 8 })
    expect(calls[0]?.url).toBe('https://api.agent37.com/v1/instances/ab12/resize')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.headers.Authorization).toBe('Bearer sk_live_5')
    expect(calls[0]?.body).toEqual({ cpu: 4, memory: 8 })
    expect(resized.resources).toEqual({ cpu: 4, memory: 8, disk: 20 })
  })

  it('reads the disk series on the API host so a pod can see how full its volume is', async () => {
    const metrics = {
      series: { disk_bytes: [[1_783_293_600, 17_179_869_184]] },
      limits: { cpu_cores: 2, memory_bytes: 4_294_967_296, disk_bytes: 21_474_836_480 },
      hours: 1,
      step_seconds: 60,
      fetched_at: 1_783_293_660,
    }
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: metrics }])
    const client = liveAgent37Client({ apiKey: 'sk_live_8', fetch: fetchImpl })
    const answer = await client.metrics({ id: 'ab12', hours: 1 })
    expect(calls[0]?.url).toBe('https://api.agent37.com/v1/instances/ab12/metrics?hours=1')
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.headers.Authorization).toBe('Bearer sk_live_8')
    expect(answer.limits.disk_bytes).toBe(21_474_836_480)
    expect(answer.series.disk_bytes).toEqual([[1_783_293_600, 17_179_869_184]])
  })

  it('resets the os layer on the API host with no body', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { id: 'ab12', status: 'updating' } },
    ])
    const client = liveAgent37Client({ apiKey: 'sk_live_9', fetch: fetchImpl })
    const updated = await client.update({ id: 'ab12' })
    expect(calls[0]?.url).toBe('https://api.agent37.com/v1/instances/ab12/update')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.headers.Authorization).toBe('Bearer sk_live_9')
    expect(calls[0]?.body).toBeUndefined()
    expect(updated.status).toBe('updating')
  })

  it('reads the instance logs and health on the API host, in any instance state', async () => {
    const logs = {
      logs: 'fatal: open /etc/hostname: read-only file system\n',
      truncated: false,
      health: { running: false, restart_count: 62, exit_code: 1, oom_suspected: false },
      fetched_at: 1_763_000_000,
    }
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: logs }])
    const client = liveAgent37Client({ apiKey: 'sk_live_10', fetch: fetchImpl })
    const answer = await client.logs({ id: 'ab12' })
    expect(calls[0]?.url).toBe('https://api.agent37.com/v1/instances/ab12/logs')
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.headers.Authorization).toBe('Bearer sk_live_10')
    expect(answer.health?.restart_count).toBe(62)
  })

  it('starts a stopped instance on the API host', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { id: 'ab12', status: 'running' } },
    ])
    const client = liveAgent37Client({ apiKey: 'sk_live_6', fetch: fetchImpl })
    const started = await client.start({ id: 'ab12' })
    expect(calls[0]?.url).toBe('https://api.agent37.com/v1/instances/ab12/start')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.headers.Authorization).toBe('Bearer sk_live_6')
    expect(started.status).toBe('running')
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

  it('throws a 409 instance_limit_reached on the first call, keeping the reason agent37 gave', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        status: 409,
        body: {
          error: {
            code: 'instance_limit_reached',
            message: 'instance limit reached: 4 of 4 instances',
          },
        },
      },
    ])
    const client = liveAgent37Client({
      apiKey: 'sk_live_6',
      fetch: fetchImpl,
      retry: { attempts: 10, delayMs: 1 },
    })
    const failure = await client.create(createArgs).catch((error) => error)
    expect(calls).toHaveLength(1)
    expect(failure).toBeInstanceOf(Agent37Error)
    expect((failure as Agent37Error).code).toBe('instance_limit_reached')
    expect((failure as Agent37Error).retryable).toBe(false)
    expect((failure as Agent37Error).detail).toBe('instance limit reached: 4 of 4 instances')
  })

  it('keeps a 503 retryable, since nothing in its body is an answer about the account', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 503, body: { error: { code: 'unavailable' } } },
      { status: 200, body: { exit_code: 0, stdout: '', stderr: '', truncated: false } },
    ])
    const client = liveAgent37Client({
      apiKey: 'sk_live_7',
      fetch: fetchImpl,
      retry: { attempts: 2, delayMs: 1 },
    })
    await client.exec({ id: 'ab12', command: 'true' })
    expect(calls).toHaveLength(2)
  })
})
