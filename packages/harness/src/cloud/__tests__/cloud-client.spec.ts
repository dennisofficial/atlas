import { describe, expect, it } from 'bun:test'

import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  toAccountId,
  type AccountDraft,
  type AccountSecret,
} from '@dltech/atlas-core'

import { CloudClient, CloudError, cloudClientFor } from '../cloud-client'

const TOKEN = 'sess_test_token'

const secret: AccountSecret = {
  kind: EAuthKind.Oauth,
  tokens: { accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: '2026-01-01T12:00:00.000Z' },
}

const accountBody = (overrides: Record<string, unknown> = {}) => ({
  id: 'acc_1',
  provider: EAuthProvider.Anthropic,
  kind: EAuthKind.Oauth,
  origin: EAccountOrigin.Login,
  label: 'work',
  status: EAccountStatus.Active,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

type Recorded = {
  url: string
  method: string
  headers: RequestInit['headers']
  body: unknown
}

const clientWith = (
  respond: (call: Recorded) => { status: number; body?: unknown },
  clientVersion?: string,
): { client: CloudClient; calls: Recorded[] } => {
  const calls: Recorded[] = []

  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const call: Recorded = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: init?.headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)

    const answer = respond(call)
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const client = new CloudClient({
    url: 'http://cloud.test/',
    token: TOKEN,
    ...(clientVersion === undefined ? {} : { clientVersion }),
    fetchFn,
  })
  return { client, calls }
}

describe('CloudClient', () => {
  it('trims a trailing slash from the url', async () => {
    const { client, calls } = clientWith(() => ({ status: 200, body: [] }))

    await client.listAccounts()

    expect(calls[0]?.url).toBe('http://cloud.test/v1/accounts')
  })

  it('sends the bearer token on account calls', async () => {
    const { client, calls } = clientWith(() => ({ status: 200, body: [] }))

    await client.listAccounts()

    expect(calls[0]?.headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      'atlas-client-version': 'dev',
    })
  })

  it('sends atlas-client-version: dev by default across GET, POST and PUT', async () => {
    const { client, calls } = clientWith((call) =>
      call.method === 'POST' ? { status: 201, body: accountBody() } : { status: 204 },
    )

    await client.readAccount({ accountId: toAccountId('acc_1') })
    await client.addAccount({
      draft: {
        provider: EAuthProvider.OpenAI,
        label: 'personal',
        secret,
        origin: EAccountOrigin.Imported,
      },
    })
    await client.putSecret({ name: 'k', value: 'v' })

    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST', 'PUT'])
    expect(calls.map((call) => new Headers(call.headers).get('atlas-client-version'))).toEqual([
      'dev',
      'dev',
      'dev',
    ])
  })

  it('sends an explicit client version on GET, POST and PUT', async () => {
    const { client, calls } = clientWith((call) => {
      if (call.method === 'POST') return { status: 201, body: accountBody() }
      if (call.method === 'GET') return { status: 200, body: [] }
      return { status: 204 }
    }, '1.2.3')

    await client.listAccounts()
    await client.addAccount({
      draft: {
        provider: EAuthProvider.OpenAI,
        label: 'personal',
        secret,
        origin: EAccountOrigin.Imported,
      },
    })
    await client.replaceAccountSecret({ accountId: toAccountId('acc_1'), secret })

    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST', 'PUT'])
    for (const call of calls) {
      expect(new Headers(call.headers).get('atlas-client-version')).toBe('1.2.3')
    }
  })

  it('sends the client version on health checks', async () => {
    const { client, calls } = clientWith(() => ({ status: 200, body: { status: 'ok' } }), '2.0.0')

    expect(await client.health()).toBe(true)
    expect(new Headers(calls[0]?.headers).get('atlas-client-version')).toBe('2.0.0')
  })

  it('health is true on a 200 and false on a failure or an unreachable host', async () => {
    const { client } = clientWith(() => ({ status: 200, body: { status: 'ok' } }))
    expect(await client.health()).toBe(true)

    const failing = clientWith(() => ({ status: 500 }))
    expect(await failing.client.health()).toBe(false)

    const down = new CloudClient({
      url: 'http://cloud.test',
      token: TOKEN,
      fetchFn: (() =>
        Promise.reject(new Error('connection refused'))) as unknown as typeof fetch,
    })
    expect(await down.health()).toBe(false)
  })

  it('lists accounts and validates them with the core schema', async () => {
    const { client, calls } = clientWith(() => ({ status: 200, body: [accountBody()] }))

    const accounts = await client.listAccounts()

    expect(calls[0]?.method).toBe('GET')
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.id).toBe(toAccountId('acc_1'))
  })

  it('rejects a malformed account payload', async () => {
    const { client } = clientWith(() => ({
      status: 200,
      body: [accountBody({ provider: 'not-a-provider' })],
    }))

    await expect(client.listAccounts()).rejects.toThrow()
  })

  it('reads one account by id', async () => {
    const { client, calls } = clientWith(() => ({
      status: 200,
      body: accountBody({ secret }),
    }))

    const stored = await client.readAccount({ accountId: toAccountId('acc_1') })

    expect(calls[0]?.url).toBe('http://cloud.test/v1/accounts/acc_1')
    expect(stored?.secret).toEqual(secret)
  })

  it('maps a 404 on read to undefined', async () => {
    const { client } = clientWith(() => ({ status: 404, body: { message: 'not found' } }))

    expect(await client.readAccount({ accountId: toAccountId('acc_missing') })).toBeUndefined()
  })

  it('adds an account, omitting absent optional fields from the body', async () => {
    const draft: AccountDraft = {
      provider: EAuthProvider.OpenAI,
      label: 'personal',
      secret,
      origin: EAccountOrigin.Imported,
      importedFrom: 'codex',
    }
    const { client, calls } = clientWith(() => ({
      status: 201,
      body: accountBody({ id: 'acc_new', provider: EAuthProvider.OpenAI, label: 'personal' }),
    }))

    const added = await client.addAccount({ draft })

    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.body).toEqual({
      provider: EAuthProvider.OpenAI,
      label: 'personal',
      secret,
      origin: EAccountOrigin.Imported,
      importedFrom: 'codex',
    })
    expect(added.id).toBe(toAccountId('acc_new'))
  })

  it('replaces an account secret', async () => {
    const { client, calls } = clientWith(() => ({ status: 204 }))

    await client.replaceAccountSecret({ accountId: toAccountId('acc_1'), secret })

    expect(calls[0]).toMatchObject({
      method: 'PUT',
      url: 'http://cloud.test/v1/accounts/acc_1/secret',
      body: { secret },
    })
  })

  it('sets an account status', async () => {
    const { client, calls } = clientWith(() => ({ status: 204 }))

    await client.setAccountStatus({
      accountId: toAccountId('acc_1'),
      status: EAccountStatus.Limited,
    })

    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      url: 'http://cloud.test/v1/accounts/acc_1/status',
      body: { status: EAccountStatus.Limited },
    })
  })

  it('removes an account', async () => {
    const { client, calls } = clientWith(() => ({ status: 204 }))

    await client.removeAccount({ accountId: toAccountId('acc_1') })

    expect(calls[0]).toMatchObject({
      method: 'DELETE',
      url: 'http://cloud.test/v1/accounts/acc_1',
    })
  })

  it('sets the active account for a provider', async () => {
    const { client, calls } = clientWith(() => ({ status: 204 }))

    await client.setActiveAccount({ provider: EAuthProvider.Anthropic, accountId: toAccountId('acc_1') })

    expect(calls[0]).toMatchObject({
      method: 'PUT',
      url: 'http://cloud.test/v1/accounts/active',
      body: { provider: EAuthProvider.Anthropic, accountId: 'acc_1' },
    })
  })

  it('reads the active account for a provider', async () => {
    const { client, calls } = clientWith(() => ({ status: 200, body: { accountId: 'acc_1' } }))

    const active = await client.activeAccount({ provider: EAuthProvider.Anthropic })

    expect(calls[0]?.url).toBe('http://cloud.test/v1/accounts/active/anthropic')
    expect(active).toBe(toAccountId('acc_1'))
  })

  it('maps a null active account to undefined', async () => {
    const { client } = clientWith(() => ({ status: 200, body: { accountId: null } }))

    expect(await client.activeAccount({ provider: EAuthProvider.OpenAI })).toBeUndefined()
  })

  it('raises a CloudError carrying the status and the server message', async () => {
    const { client } = clientWith(() => ({ status: 401, body: { message: 'session expired' } }))

    const failure = await client.listAccounts().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(401)
    expect((failure as CloudError).message).toContain('session expired')
  })

  it('raises a CloudError with status 0 when the host is unreachable', async () => {
    const client = new CloudClient({
      url: 'http://cloud.test',
      token: TOKEN,
      fetchFn: (() =>
        Promise.reject(new Error('connection refused'))) as unknown as typeof fetch,
    })

    const failure = await client.listAccounts().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(0)
    expect((failure as CloudError).message).toContain('connection refused')
  })

  it('lists secrets from the collection envelope', async () => {
    const { client, calls } = clientWith(() => ({
      status: 200,
      body: {
        secrets: [{ name: 'search.tavily', value: 'tvly-1', updatedAt: '2026-01-01T00:00:00.000Z' }],
      },
    }))

    const secrets = await client.listSecrets()

    expect(calls[0]).toMatchObject({ method: 'GET', url: 'http://cloud.test/v1/secrets' })
    expect(secrets).toEqual([
      { name: 'search.tavily', value: 'tvly-1', updatedAt: '2026-01-01T00:00:00.000Z' },
    ])
  })

  it('puts a secret value under its name', async () => {
    const { client, calls } = clientWith(() => ({ status: 204 }))

    await client.putSecret({ name: 'search.tavily', value: 'tvly-1' })

    expect(calls[0]).toMatchObject({
      method: 'PUT',
      url: 'http://cloud.test/v1/secrets/search.tavily',
      body: { value: 'tvly-1' },
    })
  })

  it('deletes a secret by name', async () => {
    const { client, calls } = clientWith(() => ({ status: 204 }))

    await client.deleteSecret({ name: 'search.tavily' })

    expect(calls[0]).toMatchObject({
      method: 'DELETE',
      url: 'http://cloud.test/v1/secrets/search.tavily',
    })
  })

  it('lists mcp servers validated against the spec schema', async () => {
    const { client, calls } = clientWith(() => ({
      status: 200,
      body: {
        servers: [
          {
            name: 'linear',
            transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' },
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          { name: 'paused', disabled: true, updatedAt: '2026-01-01T00:00:00.000Z' },
        ],
      },
    }))

    const servers = await client.listMcpServers()

    expect(calls[0]).toMatchObject({ method: 'GET', url: 'http://cloud.test/v1/mcp-servers' })
    expect(servers).toEqual([
      {
        name: 'linear',
        transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' },
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      { name: 'paused', disabled: true, updatedAt: '2026-01-01T00:00:00.000Z' },
    ])
  })

  it('rejects an mcp server entry the spec schema would not load', async () => {
    const { client } = clientWith(() => ({
      status: 200,
      body: { servers: [{ name: 'broken', updatedAt: '2026-01-01T00:00:00.000Z' }] },
    }))

    await expect(client.listMcpServers()).rejects.toThrow()
  })

  it('puts an mcp server, omitting absent optional fields from the body', async () => {
    const { client, calls } = clientWith(() => ({ status: 204 }))

    await client.putMcpServer({
      name: 'linear',
      transport: { kind: 'stdio', command: 'npx', args: ['-y', 'linear-mcp'] },
    })

    expect(calls[0]).toMatchObject({
      method: 'PUT',
      url: 'http://cloud.test/v1/mcp-servers/linear',
      body: {
        transport: { kind: 'stdio', command: 'npx', args: ['-y', 'linear-mcp'] },
      },
    })
  })

  it('deletes an mcp server by name', async () => {
    const { client, calls } = clientWith(() => ({ status: 204 }))

    await client.deleteMcpServer({ name: 'linear' })

    expect(calls[0]).toMatchObject({
      method: 'DELETE',
      url: 'http://cloud.test/v1/mcp-servers/linear',
    })
  })
})

describe('cloudClientFor', () => {
  const session = { url: 'http://cloud.test/', token: 'sess_from_session', email: 'a@b.c' }

  it('builds a client carrying the session url, token and the given version', async () => {
    const calls: Recorded[] = []
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: init?.headers,
        body: undefined,
      })
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const client = cloudClientFor({ session, clientVersion: '3.1.4', fetchFn })
    await client.listAccounts()

    expect(client.baseUrl).toBe('http://cloud.test')
    expect(calls[0]?.headers).toEqual({
      authorization: 'Bearer sess_from_session',
      'atlas-client-version': '3.1.4',
    })
  })

  it('defaults the version to dev when none is given', async () => {
    const calls: Recorded[] = []
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: init?.headers,
        body: undefined,
      })
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const client = cloudClientFor({ session, fetchFn })
    await client.listAccounts()

    expect(new Headers(calls[0]?.headers).get('atlas-client-version')).toBe('dev')
  })
})
