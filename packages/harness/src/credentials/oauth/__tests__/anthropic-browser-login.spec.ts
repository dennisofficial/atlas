import { createHash } from 'node:crypto'

import { describe, expect, it } from 'bun:test'

import type { ClockPort } from '@dltech/atlas-core'

import type { AnthropicLoopback } from '../anthropic-loopback'
import { AnthropicOauthClient } from '../anthropic-oauth-client'

const clock: ClockPort = { now: () => '2026-01-01T00:00:00.000Z' }

const TOKEN_RESPONSE = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  scope: 'org:create_api_key user:profile user:inference',
  account: { email_address: 'dennis@example.com', subscription_type: 'max' },
}

class FakeLoopback implements AnthropicLoopback {
  closed = 0
  waitedFor: string | undefined
  private deliver: ((callback: { code: string }) => void) | undefined
  private fail: ((reason: Error) => void) | undefined

  constructor(private readonly port = 53692) {}

  listen = async () => ({
    port: this.port,
    redirectUri: `http://localhost:${this.port}/callback`,
  })

  waitForCallback = (args: { state: string }): Promise<{ code: string }> => {
    this.waitedFor = args.state
    return new Promise((resolve, reject) => {
      this.deliver = resolve
      this.fail = reject
    })
  }

  close = async () => {
    this.closed += 1
    this.fail?.(new Error('the callback server closed'))
  }

  callback(code: string): void {
    this.deliver?.({ code })
  }
}

type Call = { url: string; body: string; headers: Record<string, string>; method: string }

const clientWith = (args: { loopback: FakeLoopback; status?: number; response?: unknown }) => {
  const calls: Call[] = []
  const client = new AnthropicOauthClient({
    clock,
    loopback: () => args.loopback,
    fetch: async (input, init) => {
      calls.push({
        url: String(input),
        body: String(init?.body ?? ''),
        headers: (init?.headers ?? {}) as Record<string, string>,
        method: init?.method ?? '',
      })
      return new Response(JSON.stringify(args.response ?? TOKEN_RESPONSE), {
        status: args.status ?? 200,
      })
    },
  })

  return { client, calls }
}

describe('AnthropicOauthClient browser login', () => {
  it('builds the authorize url as Claude Code does, with no code=true param', async () => {
    const loopback = new FakeLoopback()
    const { client } = clientWith({ loopback })

    const session = await client.startBrowserLogin()
    const url = new URL(session.url)

    expect(`${url.origin}${url.pathname}`).toBe('https://claude.com/cai/oauth/authorize')
    expect([...url.searchParams.keys()].sort()).toEqual(
      [
        'client_id',
        'code_challenge',
        'code_challenge_method',
        'redirect_uri',
        'response_type',
        'scope',
        'state',
      ].sort(),
    )
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:53692/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('org:create_api_key user:profile user:inference')
    expect(url.searchParams.has('code')).toBe(false)
    expect(url.searchParams.get('state')).toHaveLength(43)
    expect(loopback.waitedFor).toBe(url.searchParams.get('state') ?? undefined)

    await session.cancel()
    await session.login.catch(() => undefined)
  })

  it('exchanges the code with the verifier behind the challenge and the redirect uri that bound', async () => {
    const loopback = new FakeLoopback(8976)
    const { client, calls } = clientWith({ loopback })

    const session = await client.startBrowserLogin()
    const challenge = new URL(session.url).searchParams.get('code_challenge')
    const state = new URL(session.url).searchParams.get('state')
    loopback.callback('the-code')
    const login = await session.login

    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call?.url).toBe('https://platform.claude.com/v1/oauth/token')
    expect(call?.method).toBe('POST')
    expect(call?.headers).toEqual({ 'content-type': 'application/json' })

    const body = JSON.parse(call?.body ?? '{}') as Record<string, unknown>
    expect(body).toEqual({
      grant_type: 'authorization_code',
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      code: 'the-code',
      state,
      redirect_uri: 'http://localhost:8976/callback',
      code_verifier: body.code_verifier,
    })

    const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : ''
    expect(verifier).toHaveLength(43)
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge ?? '')

    expect(login).toMatchObject({
      email: 'dennis@example.com',
      subscription: 'max',
      tokens: { refreshToken: 'refresh-1', scopes: TOKEN_RESPONSE.scope.split(' ') },
    })
    expect(loopback.closed).toBeGreaterThan(0)
  })

  it('keeps the label email-only when the token response carries no subscription_type', async () => {
    const loopback = new FakeLoopback()
    const { client } = clientWith({
      loopback,
      response: { ...TOKEN_RESPONSE, account: { email_address: 'dennis@example.com' } },
    })

    const session = await client.startBrowserLogin()
    loopback.callback('the-code')
    const login = await session.login

    expect(login.email).toBe('dennis@example.com')
    expect(login.subscription).toBeUndefined()
  })

  it('draws fresh verifier and state on every attempt', async () => {
    const first = await clientWith({ loopback: new FakeLoopback() }).client.startBrowserLogin()
    const second = await clientWith({ loopback: new FakeLoopback() }).client.startBrowserLogin()

    const stateOf = (url: string) => new URL(url).searchParams.get('state')
    const challengeOf = (url: string) => new URL(url).searchParams.get('code_challenge')
    expect(stateOf(first.url)).not.toBe(stateOf(second.url))
    expect(challengeOf(first.url)).not.toBe(challengeOf(second.url))

    await Promise.all([first.cancel(), second.cancel()])
    await Promise.all([first.login.catch(() => undefined), second.login.catch(() => undefined)])
  })

  it('rejects the login and closes the server when the token exchange fails', async () => {
    const loopback = new FakeLoopback()
    const { client } = clientWith({ loopback, status: 400 })

    const session = await client.startBrowserLogin()
    loopback.callback('the-code')

    const failure = await session.login.catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(loopback.closed).toBeGreaterThan(0)
  })

  it('rejects with sign-in cancelled and closes the server when cancelled', async () => {
    const loopback = new FakeLoopback()
    const { client, calls } = clientWith({ loopback })

    const session = await client.startBrowserLogin()
    await session.cancel()

    const failure = await session.login.catch((error: unknown) => error)

    expect((failure as Error).message).toBe('sign-in cancelled')
    expect(loopback.closed).toBeGreaterThan(0)
    expect(calls).toEqual([])
  })
})
