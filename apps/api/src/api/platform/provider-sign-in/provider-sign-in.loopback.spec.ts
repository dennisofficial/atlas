import { EOauthProvider, EProviderSignInFlow } from '@dltech/atlas-wire'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  jwt,
  START,
  type StubHttp,
  USER,
  useProviderSignIn,
} from './provider-sign-in.service.fixture'
import { PASTE_ATTEMPT_TTL_MS, type ProviderSignInService } from './provider-sign-in.service'

describe('ProviderSignInService loopback', () => {
  const harness = useProviderSignIn()
  let http: StubHttp
  let service: ProviderSignInService

  beforeEach(() => {
    ;({ http, service } = harness())
  })

  const beginLoopback = async (args: { provider: EOauthProvider; redirectUri: string }) => {
    const begun = await service.begin({
      userId: USER,
      provider: args.provider,
      flow: EProviderSignInFlow.Loopback,
      redirectUri: args.redirectUri,
    })
    if (begun.flow !== EProviderSignInFlow.Loopback) throw new Error('expected loopback')
    return begun
  }

  it('begins Claude on a loopback the CLI registers, keeping the verifier sealed', async () => {
    const begun = await beginLoopback({
      provider: EOauthProvider.Anthropic,
      redirectUri: 'http://localhost:53682/callback',
    })
    const url = new URL(begun.authorizeUrl)

    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:53682/callback')
    expect(url.searchParams.get('code')).toBe('true')
    expect(url.searchParams.get('state')).toBe(begun.state)
    expect(begun.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(begun.attemptId).not.toContain(begun.state)
    expect(begun.expiresInMs).toBe(PASTE_ATTEMPT_TTL_MS)
    expect(http.calls).toEqual([])
  })

  it('begins Codex on the loopback Codex registers, with its own scopes', async () => {
    const begun = await beginLoopback({
      provider: EOauthProvider.OpenAI,
      redirectUri: 'http://127.0.0.1:1455/auth/callback',
    })
    const url = new URL(begun.authorizeUrl)

    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1455/auth/callback')
    expect(url.searchParams.get('originator')).toBe('codex_cli_rs')
    expect(url.searchParams.get('state')).toBe(begun.state)
    expect(http.calls).toEqual([])
  })

  it('refuses a loopback address the provider does not register', async () => {
    const refused = [
      { provider: EOauthProvider.Anthropic, redirectUri: 'http://127.0.0.1:53682/callback' },
      { provider: EOauthProvider.Anthropic, redirectUri: 'http://localhost:80/callback' },
      { provider: EOauthProvider.OpenAI, redirectUri: 'http://127.0.0.1:1456/auth/callback' },
      { provider: EOauthProvider.OpenAI, redirectUri: 'http://localhost:1455/auth/callback' },
      { provider: EOauthProvider.OpenAI, redirectUri: 'https://example.test/callback' },
    ]

    for (const attempt of refused)
      await expect(beginLoopback(attempt)).rejects.toThrow(/only returns to its own loopback/)

    await expect(
      service.begin({
        userId: USER,
        provider: EOauthProvider.Anthropic,
        flow: EProviderSignInFlow.Loopback,
      }),
    ).rejects.toThrow(/needs the loopback address/)
  })

  it('exchanges a Claude loopback code with the same redirect address', async () => {
    const begun = await beginLoopback({
      provider: EOauthProvider.Anthropic,
      redirectUri: 'http://localhost:53682/callback',
    })
    http.answer(200, {
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      account: { email_address: 'dev@example.com', subscription_type: 'max' },
    })

    const account = await service.complete({
      userId: USER,
      attemptId: begun.attemptId,
      code: 'the-code',
    })

    const sent = JSON.parse(http.calls[0]?.body ?? '{}') as Record<string, string>
    expect(sent).toMatchObject({
      code: 'the-code',
      redirect_uri: 'http://localhost:53682/callback',
      grant_type: 'authorization_code',
    })
    expect(sent.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(sent.state).toBe(begun.state)
    expect(account).toMatchObject({ provider: 'anthropic', label: 'dev@example.com' })
  })

  it('exchanges a Codex loopback code with the verifier it began with', async () => {
    const begun = await beginLoopback({
      provider: EOauthProvider.OpenAI,
      redirectUri: 'http://127.0.0.1:1457/auth/callback',
    })
    http.answer(200, {
      id_token: jwt({
        email: 'gpt@example.com',
        'https://api.openai.com/auth': { chatgpt_plan_type: 'pro' },
      }),
      access_token: 'oa-access',
      refresh_token: 'oa-refresh',
      expires_in: 3600,
    })

    const account = await service.complete({
      userId: USER,
      attemptId: begun.attemptId,
      code: 'the-code',
    })

    const sent = new URLSearchParams(http.calls[0]?.body ?? '')
    expect(http.calls[0]?.url).toBe('https://auth.openai.com/oauth/token')
    expect(sent.get('code')).toBe('the-code')
    expect(sent.get('redirect_uri')).toBe('http://127.0.0.1:1457/auth/callback')
    expect(sent.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(account).toMatchObject({ provider: 'openai', email: 'gpt@example.com' })
  })

  it('will not poll a loopback attempt, and expires it', async () => {
    const begun = await beginLoopback({
      provider: EOauthProvider.Anthropic,
      redirectUri: 'http://localhost:53682/callback',
    })

    await expect(service.poll({ userId: USER, attemptId: begun.attemptId })).rejects.toThrow(
      /finishes in the browser/,
    )

    http.nowMs = START + PASTE_ATTEMPT_TTL_MS + 1
    await expect(
      service.complete({ userId: USER, attemptId: begun.attemptId, code: 'the-code' }),
    ).rejects.toThrow(/expired/)
    expect(http.calls).toEqual([])
  })
})
