import { describe, expect, it } from 'bun:test'
import { ESshSigningKeyState } from '@dltech/atlas-wire'

import { CloudError } from '../cloud-transport'
import { SigningKeyClient } from '../signing-key-client'

type Call = { method: string; path: string; authorization: string | null; body: unknown }
type Reply = { status: number; body?: unknown }

const fakeApi = (args: { reply: Reply }) => {
  const calls: Call[] = []
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({
      method: init?.method ?? 'GET',
      path: new URL(String(input)).pathname,
      authorization: headers.get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    return new Response(args.reply.body === undefined ? '' : JSON.stringify(args.reply.body), {
      status: args.reply.status,
    })
  }) as typeof fetch
  const client = new SigningKeyClient({
    url: 'https://cloud.test/',
    token: 'sess_1',
    clientVersion: '1.0.0',
    fetchFn,
  })
  return { client, calls }
}

const registered = {
  state: 'registered',
  publicKey: 'ssh-ed25519 AAAA',
  createdAt: '2026-10-19T00:00:00.000Z',
}

describe('SigningKeyClient', () => {
  it('reads absent and registered status with the bearer token', async () => {
    const absent = fakeApi({ reply: { status: 200, body: { state: 'absent' } } })
    expect(await absent.client.status()).toEqual({ state: ESshSigningKeyState.Absent })
    expect(absent.calls).toEqual([
      {
        method: 'GET',
        path: '/v1/ssh-signing-key/status',
        authorization: 'Bearer sess_1',
        body: undefined,
      },
    ])

    const present = fakeApi({ reply: { status: 200, body: registered } })
    expect(await present.client.status()).toEqual({
      ...registered,
      state: ESshSigningKeyState.Registered,
    })
  })

  it('posts the private key on register and rotate', async () => {
    const api = fakeApi({ reply: { status: 201, body: registered } })

    await api.client.register({ privateKey: 'PEM-1' })
    await api.client.rotate({ privateKey: 'PEM-2' })

    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /v1/ssh-signing-key',
      'POST /v1/ssh-signing-key/rotate',
    ])
    expect(api.calls.map((call) => call.body)).toEqual([
      { privateKey: 'PEM-1' },
      { privateKey: 'PEM-2' },
    ])
  })

  it('deletes on revoke', async () => {
    const api = fakeApi({ reply: { status: 204 } })

    await api.client.revoke()

    expect(api.calls).toEqual([
      {
        method: 'DELETE',
        path: '/v1/ssh-signing-key',
        authorization: 'Bearer sess_1',
        body: undefined,
      },
    ])
  })

  it('refuses a status body that does not match the wire schema', async () => {
    const api = fakeApi({ reply: { status: 200, body: { state: 'mystery' } } })

    const error = await api.client.status().catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(CloudError)
    expect((error as CloudError).status).toBe(502)
  })

  it('carries the response code and status on a refusal', async () => {
    const api = fakeApi({
      reply: {
        status: 403,
        body: { code: 'github-signing-scope-missing', message: 'reconnect GitHub' },
      },
    })

    const error = await api.client.register({ privateKey: 'PEM' }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(CloudError)
    expect((error as CloudError).status).toBe(403)
    expect((error as CloudError).code).toBe('github-signing-scope-missing')
  })
})
