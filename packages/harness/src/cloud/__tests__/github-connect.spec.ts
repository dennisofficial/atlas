import { describe, expect, it } from 'bun:test'

import { CloudClient, CloudError } from '../cloud-client'
import { EGithubConnectPoll } from '../github-connect'

const TOKEN = 'sess_test_token'

type Recorded = {
  url: string
  method: string
  headers: RequestInit['headers']
  body: unknown
}

const clientWith = (
  respond: (call: Recorded) => { status: number; body?: unknown },
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

  return { client: new CloudClient({ url: 'http://cloud.test/', token: TOKEN, fetchFn }), calls }
}

const ticketBody = {
  deviceCode: 'dev_code_1',
  userCode: 'ABCD-EFGH',
  verificationUrl: 'https://github.com/login/device',
  expiresInMs: 300_000,
  intervalMs: 5_000,
}

describe('CloudClient github connect', () => {
  it('begins the connect flow and returns the ticket', async () => {
    const { client, calls } = clientWith(() => ({ status: 200, body: ticketBody }))

    const ticket = await client.beginGithubConnect()

    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'http://cloud.test/v1/github/connect/begin',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(ticket).toEqual(ticketBody)
  })

  it('surfaces a 503 as a CloudError carrying the server message', async () => {
    const { client } = clientWith(() => ({
      status: 503,
      body: { message: 'github connect is not configured' },
    }))

    const failure = await client.beginGithubConnect().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(503)
    expect((failure as CloudError).message).toContain('github connect is not configured')
  })

  it('maps every pending-style poll status to its enum member', async () => {
    const cases = [
      ['pending', EGithubConnectPoll.Pending],
      ['slow-down', EGithubConnectPoll.SlowDown],
      ['denied', EGithubConnectPoll.Denied],
      ['expired', EGithubConnectPoll.Expired],
    ] as const

    for (const [wire, status] of cases) {
      const { client, calls } = clientWith(() => ({ status: 200, body: { status: wire } }))

      const outcome = await client.pollGithubConnect({ deviceCode: 'dev_code_1' })

      expect(calls[0]).toMatchObject({
        method: 'POST',
        url: 'http://cloud.test/v1/github/connect/poll',
        body: { deviceCode: 'dev_code_1' },
      })
      expect(outcome).toEqual({ status })
    }
  })

  it('carries the connection on a connected poll', async () => {
    const { client } = clientWith(() => ({
      status: 200,
      body: { status: 'connected', login: 'dennis', scopes: ['repo', 'read:org'] },
    }))

    const outcome = await client.pollGithubConnect({ deviceCode: 'dev_code_1' })

    expect(outcome.status).toBe(EGithubConnectPoll.Connected)
    if (outcome.status !== EGithubConnectPoll.Connected) throw new Error('unreachable')
    expect(outcome.connection.login).toBe('dennis')
    expect(outcome.connection.scopes).toEqual(['repo', 'read:org'])
  })

  it('rejects a malformed connected poll payload', async () => {
    const { client } = clientWith(() => ({
      status: 200,
      body: { status: 'connected', login: 'dennis' },
    }))

    await expect(client.pollGithubConnect({ deviceCode: 'dev_code_1' })).rejects.toThrow()
  })

  it('maps a disconnected state to null', async () => {
    const { client, calls } = clientWith(() => ({ status: 200, body: { connected: false } }))

    const connection = await client.githubConnection()

    expect(calls[0]).toMatchObject({ method: 'GET', url: 'http://cloud.test/v1/github' })
    expect(connection).toBeNull()
  })

  it('returns the connection with its scopes when connected', async () => {
    const { client } = clientWith(() => ({
      status: 200,
      body: {
        connected: true,
        login: 'dennis',
        scopes: ['repo'],
        connectedAt: '2026-01-01T00:00:00.000Z',
      },
    }))

    const connection = await client.githubConnection()

    expect(connection).toEqual({
      login: 'dennis',
      scopes: ['repo'],
      connectedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('returns the github token', async () => {
    const { client, calls } = clientWith(() => ({ status: 200, body: { token: 'gho_1' } }))

    const token = await client.githubToken()

    expect(calls[0]).toMatchObject({ method: 'GET', url: 'http://cloud.test/v1/github/token' })
    expect(token).toBe('gho_1')
  })

  it('maps a 404 on the token route to undefined', async () => {
    const { client } = clientWith(() => ({ status: 404, body: { message: 'not found' } }))

    expect(await client.githubToken()).toBeUndefined()
  })

  it('disconnects github with a DELETE', async () => {
    const { client, calls } = clientWith(() => ({ status: 204 }))

    await client.disconnectGithub()

    expect(calls[0]).toMatchObject({ method: 'DELETE', url: 'http://cloud.test/v1/github' })
  })
})
