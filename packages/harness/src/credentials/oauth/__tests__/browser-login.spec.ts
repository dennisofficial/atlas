import { createHash } from 'node:crypto'

import { describe, expect, it } from 'bun:test'

import type { ClockPort } from '@dltech/atlas-core'

import type { CodexLoopback } from '../codex-loopback'
import { CodexOauthClient } from '../codex-oauth-client'

const clock: ClockPort = { now: () => '2026-01-01T00:00:00.000Z' }

const jwt = (claims: Record<string, unknown>): string =>
  `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`

const TOKEN_RESPONSE = {
  id_token: jwt({
    email: 'dennis@example.com',
    'https://api.openai.com/auth': { chatgpt_account_id: 'acct-123', chatgpt_plan_type: 'plus' },
  }),
  access_token: jwt({ exp: 1_767_225_600 }),
  refresh_token: 'refresh-1',
  expires_in: 3600,
}

class FakeLoopback implements CodexLoopback {
  closed = 0
  waitedFor: string | undefined
  private deliver: ((callback: { code: string }) => void) | undefined
  private fail: ((reason: Error) => void) | undefined

  constructor(private readonly port = 1455) {}

  listen = async () => ({
    port: this.port,
    redirectUri: `http://127.0.0.1:${this.port}/auth/callback`,
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

const clientWith = (args: { loopback: FakeLoopback; status?: number }) => {
  const calls: Call[] = []
  const client = new CodexOauthClient({
    clock,
    loopback: () => args.loopback,
    fetch: async (input, init) => {
      calls.push({
        url: String(input),
        body: String(init?.body ?? ''),
        headers: (init?.headers ?? {}) as Record<string, string>,
        method: init?.method ?? '',
      })
      return new Response(JSON.stringify(TOKEN_RESPONSE), { status: args.status ?? 200 })
    },
  })

  return { client, calls }
}

describe('CodexOauthClient browser login', () => {
  it('builds the authorize url byte-for-byte as codex login does', async () => {
    const loopback = new FakeLoopback()
    const { client } = clientWith({ loopback })

    const session = await client.startBrowserLogin()
    const url = new URL(session.url)

    expect(`${url.origin}${url.pathname}`).toBe('https://auth.openai.com/oauth/authorize')
    expect([...url.searchParams.keys()].sort()).toEqual(
      [
        'client_id',
        'code_challenge',
        'code_challenge_method',
        'codex_cli_simplified_flow',
        'id_token_add_organizations',
        'originator',
        'redirect_uri',
        'response_type',
        'scope',
        'state',
      ].sort(),
    )
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1455/auth/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe(
      'openid profile email offline_access api.connectors.read api.connectors.invoke',
    )
    expect(url.searchParams.get('id_token_add_organizations')).toBe('true')
    expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true')
    expect(url.searchParams.get('originator')).toBe('codex_cli_rs')
    expect(url.searchParams.get('state')).toHaveLength(43)
    expect(loopback.waitedFor).toBe(url.searchParams.get('state') ?? undefined)

    await session.cancel()
    await session.login.catch(() => undefined)
  })

  it('exchanges the code with the verifier behind the challenge and the redirect uri that bound', async () => {
    const loopback = new FakeLoopback(1457)
    const { client, calls } = clientWith({ loopback })

    const session = await client.startBrowserLogin()
    const challenge = new URL(session.url).searchParams.get('code_challenge')
    loopback.callback('the-code')
    const login = await session.login

    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call?.url).toBe('https://auth.openai.com/oauth/token')
    expect(call?.method).toBe('POST')
    expect(call?.headers).toEqual({ 'content-type': 'application/x-www-form-urlencoded' })

    const form = new URLSearchParams(call?.body)
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      code: 'the-code',
      redirect_uri: 'http://127.0.0.1:1457/auth/callback',
      code_verifier: form.get('code_verifier') ?? '',
    })

    const verifier = form.get('code_verifier') ?? ''
    expect(verifier).toHaveLength(86)
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge ?? '')

    expect(login).toMatchObject({
      email: 'dennis@example.com',
      subscription: 'plus',
      tokens: { refreshToken: 'refresh-1', accountId: 'acct-123' },
    })
    expect(loopback.closed).toBeGreaterThan(0)
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
