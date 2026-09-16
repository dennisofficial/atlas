import { describe, expect, it } from 'bun:test'

import { CloudError } from '../cloud-transport'
import { ECloudSandboxState, SandboxClient } from '../sandbox-client'

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown }

const harness = (replies: readonly { status?: number; body?: unknown }[]) => {
  const calls: Call[] = []
  let at = 0

  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: headers ?? {},
      ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) }),
    })
    const reply = replies[at]
    at += 1
    return new Response(reply?.body === undefined ? '' : JSON.stringify(reply.body), {
      status: reply?.status ?? 200,
    })
  }) as typeof fetch

  const client = new SandboxClient({
    url: 'https://cloud.test/',
    token: 'sess_test',
    clientVersion: '1.2.3',
    fetchFn,
  })
  return { client, calls }
}

describe('creating a sandbox', () => {
  it('posts the thread id and reads back the url, token and state', async () => {
    const { client, calls } = harness([
      { body: { url: 'https://box.vercel.run', token: 'tok_1', state: 'running' } },
    ])

    const sandbox = await client.createSandbox({ threadId: 'brn_cloud' })

    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url).toBe('https://cloud.test/v1/sandboxes')
    expect(calls[0]?.body).toEqual({ threadId: 'brn_cloud' })
    expect(sandbox).toEqual({
      url: 'https://box.vercel.run',
      token: 'tok_1',
      state: ECloudSandboxState.Running,
    })
  })

  it('carries the bearer token and the client version', async () => {
    const { client, calls } = harness([
      { body: { url: 'https://box.vercel.run', token: 'tok_1', state: 'running' } },
    ])

    await client.createSandbox({ threadId: 'brn_cloud' })

    expect(calls[0]?.headers.authorization).toBe('Bearer sess_test')
    expect(calls[0]?.headers['atlas-client-version']).toBe('1.2.3')
  })

  it('refuses a response that is not the creation shape', async () => {
    const { client } = harness([{ body: { url: 'https://box.vercel.run', state: 'running' } }])

    await expect(client.createSandbox({ threadId: 'brn_cloud' })).rejects.toThrow()
  })

  it('surfaces a failure as a CloudError carrying the status', async () => {
    const { client } = harness([{ status: 402, body: { message: 'no sandbox entitlement' } }])

    const failure = await client.createSandbox({ threadId: 'brn_cloud' }).catch((error) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(402)
    expect((failure as CloudError).message).toContain('no sandbox entitlement')
  })
})

describe('stopping a sandbox', () => {
  it('posts to the stop path and answers nothing', async () => {
    const { client, calls } = harness([{}])

    expect(await client.stopSandbox({ threadId: 'brn_cloud' })).toBeUndefined()
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url).toBe('https://cloud.test/v1/sandboxes/brn_cloud/stop')
  })

  it('surfaces a failure as a CloudError', async () => {
    const { client } = harness([{ status: 500, body: { message: 'vercel said no' } }])

    await expect(client.stopSandbox({ threadId: 'brn_cloud' })).rejects.toBeInstanceOf(CloudError)
  })
})

describe('reading sandbox state', () => {
  it('answers the state and the url when there is one', async () => {
    const { client, calls } = harness([
      { body: { state: 'running', url: 'https://box.vercel.run' } },
    ])

    const status = await client.findSandbox({ threadId: 'brn_cloud' })

    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.url).toBe('https://cloud.test/v1/sandboxes/brn_cloud')
    expect(status).toEqual({ state: ECloudSandboxState.Running, url: 'https://box.vercel.run' })
  })

  it('answers a parked sandbox without a url', async () => {
    const { client } = harness([{ body: { state: 'parked' } }])

    expect(await client.findSandbox({ threadId: 'brn_cloud' })).toEqual({
      state: ECloudSandboxState.Parked,
    })
  })

  it('answers a resuming sandbox', async () => {
    const { client } = harness([{ body: { state: 'resuming' } }])

    expect(await client.findSandbox({ threadId: 'brn_cloud' })).toEqual({
      state: ECloudSandboxState.Resuming,
    })
  })

  it('answers nothing for a thread with no sandbox', async () => {
    const { client } = harness([{ status: 404, body: { message: 'not found' } }])

    expect(await client.findSandbox({ threadId: 'brn_cloud' })).toBeUndefined()
  })

  it('surfaces any other failure as a CloudError', async () => {
    const { client } = harness([{ status: 401, body: { message: 'expired session' } }])

    await expect(client.findSandbox({ threadId: 'brn_cloud' })).rejects.toBeInstanceOf(CloudError)
  })
})
