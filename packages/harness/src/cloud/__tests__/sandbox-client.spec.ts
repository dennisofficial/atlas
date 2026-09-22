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

  it('accepts a resuming response with no url yet, for the caller to poll status', async () => {
    const { client, calls } = harness([{ body: { token: 'tok_1', state: 'resuming' } }])

    const sandbox = await client.createSandbox({ threadId: 'brn_cloud' })

    expect(calls[0]?.method).toBe('POST')
    expect(sandbox).toEqual({ token: 'tok_1', state: ECloudSandboxState.Resuming })
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

describe('exposing a port', () => {
  it('posts the port to the expose path and answers the routed url', async () => {
    const { client, calls } = harness([{ body: { url: 'https://sb-x.vercel.run' } }])

    const url = await client.exposePort({ threadId: 'brn_cloud', port: 3001 })

    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url).toBe('https://cloud.test/v1/sandboxes/brn_cloud/expose')
    expect(calls[0]?.body).toEqual({ port: 3001 })
    expect(url).toBe('https://sb-x.vercel.run')
  })

  it('refuses a response that is not the exposure shape', async () => {
    const { client } = harness([{ body: { state: 'running' } }])

    await expect(client.exposePort({ threadId: 'brn_cloud', port: 3001 })).rejects.toThrow()
  })

  it('surfaces a refusal — wrong token, missing sandbox, port ceiling — as a CloudError', async () => {
    const { client } = harness([{ status: 400, body: { message: 'at most 15 ports' } }])

    const failure = await client
      .exposePort({ threadId: 'brn_cloud', port: 3001 })
      .catch((error) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).message).toContain('at most 15 ports')
  })
})

describe('putting a context archive', () => {
  it('puts the raw gzip bytes to the thread’s context route with operator-session auth', async () => {
    const calls: { url: string; method: string; headers: Record<string, string>; body?: Uint8Array }[] = []
    const bytes = new Uint8Array([0x1f, 0x8b, 0, 1, 2])
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: headers ?? {},
        ...(init?.body === undefined ? {} : { body: init.body as Uint8Array }),
      })
      return new Response(null, { status: 204 })
    }) as typeof fetch
    const client = new SandboxClient({
      url: 'https://cloud.test/',
      token: 'sess_test',
      clientVersion: '1.2.3',
      fetchFn,
    })

    await client.putContextArchive({ threadId: 'brn_cloud', archive: bytes })

    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.url).toBe('https://cloud.test/v1/sandboxes/brn_cloud/context')
    expect(calls[0]?.headers.authorization).toBe('Bearer sess_test')
    expect(calls[0]?.headers['content-type']).toBe('application/gzip')
    expect(calls[0]?.body).toEqual(bytes)
  })

  it('surfaces a failure as a CloudError', async () => {
    const fetchFn = (async (_input: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify({ message: 'over the limit' }), { status: 413 })) as typeof fetch
    const client = new SandboxClient({
      url: 'https://cloud.test/',
      token: 'sess_test',
      clientVersion: '1.2.3',
      fetchFn,
    })

    const failure = await client
      .putContextArchive({ threadId: 'brn_cloud', archive: new Uint8Array(0) })
      .catch((error) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(413)
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

describe('destroying a sandbox', () => {
  it('posts to the destroy path and answers nothing', async () => {
    const { client, calls } = harness([{}])

    expect(await client.destroySandbox({ threadId: 'brn_cloud' })).toBeUndefined()
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url).toBe('https://cloud.test/v1/sandboxes/brn_cloud/destroy')
    expect(calls[0]?.headers.authorization).toBe('Bearer sess_test')
  })

  it('treats a sandbox already gone as success rather than a failure', async () => {
    const { client } = harness([{ status: 404, body: { message: 'not found' } }])

    expect(await client.destroySandbox({ threadId: 'brn_cloud' })).toBeUndefined()
  })

  it('surfaces any other failure as a CloudError', async () => {
    const { client } = harness([{ status: 500, body: { message: 'vercel said no' } }])

    await expect(client.destroySandbox({ threadId: 'brn_cloud' })).rejects.toBeInstanceOf(
      CloudError,
    )
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

  it('carries contextPending through so the caller knows whether to upload', async () => {
    const { client } = harness([{ body: { state: 'running', contextPending: false } }])

    expect(await client.findSandbox({ threadId: 'brn_cloud' })).toEqual({
      state: ECloudSandboxState.Running,
      contextPending: false,
    })
  })

  it('tolerates an older control plane that does not know contextPending yet', async () => {
    const { client } = harness([{ body: { state: 'running' } }])

    expect(await client.findSandbox({ threadId: 'brn_cloud' })).toEqual({
      state: ECloudSandboxState.Running,
    })
  })

  it('surfaces any other failure as a CloudError', async () => {
    const { client } = harness([{ status: 401, body: { message: 'expired session' } }])

    await expect(client.findSandbox({ threadId: 'brn_cloud' })).rejects.toBeInstanceOf(CloudError)
  })
})
