import { describe, expect, it } from 'bun:test'

import { CloudError } from '../cloud-transport'
import { SandboxClient } from '../sandbox-client'

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

describe('claiming a sandbox', () => {
  it('posts the thread id, git token and context flag, and reads back the session token', async () => {
    const { client, calls } = harness([{ body: { token: 'tok_1' } }])

    const claim = await client.claimSandbox({
      threadId: 'brn_cloud',
      gitToken: 'gho_abc',
      contextPending: true,
    })

    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.url).toBe('https://cloud.test/v1/sandboxes')
    expect(calls[0]?.body).toEqual({
      threadId: 'brn_cloud',
      gitToken: 'gho_abc',
      contextPending: true,
    })
    expect(claim).toEqual({ token: 'tok_1' })
  })

  it('carries the workspace spec when one is being lifted', async () => {
    const { client, calls } = harness([{ body: { token: 'tok_1' } }])
    const workspace = {
      remoteUrl: 'https://github.com/compai/atlas',
      branch: 'main',
      commit: 'abc123',
      patch: '',
      projectDirectory: '/code/atlas',
    }

    await client.claimSandbox({
      threadId: 'brn_cloud',
      gitToken: 'gho_abc',
      contextPending: true,
      workspace,
    })

    expect(calls[0]?.body).toEqual({
      threadId: 'brn_cloud',
      gitToken: 'gho_abc',
      contextPending: true,
      workspace,
    })
  })

  it('carries the bearer token and the client version', async () => {
    const { client, calls } = harness([{ body: { token: 'tok_1' } }])

    await client.claimSandbox({ threadId: 'brn_cloud', gitToken: 'gho_abc', contextPending: false })

    expect(calls[0]?.headers.authorization).toBe('Bearer sess_test')
    expect(calls[0]?.headers['atlas-client-version']).toBe('1.2.3')
  })

  it('refuses a response carrying no session token', async () => {
    const { client } = harness([{ body: { threadId: 'brn_cloud' } }])

    await expect(
      client.claimSandbox({ threadId: 'brn_cloud', gitToken: 'gho_abc', contextPending: true }),
    ).rejects.toThrow()
  })

  it('surfaces a failure as a CloudError carrying the status', async () => {
    const { client } = harness([{ status: 402, body: { message: 'no sandbox entitlement' } }])

    const failure = await client
      .claimSandbox({ threadId: 'brn_cloud', gitToken: 'gho_abc', contextPending: true })
      .catch((error) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(402)
    expect((failure as CloudError).message).toContain('no sandbox entitlement')
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
