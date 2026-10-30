import { BadRequestException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import type { ProviderFetch } from '@dltech/atlas-harness/provider-oauth'
import {
  EAuthKind,
  EOauthProvider,
  EProviderSignInFlow,
  EProviderSignInPoll,
} from '@dltech/atlas-wire'
import { beforeEach, describe, expect, it } from 'bun:test'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { AccountsService } from '../accounts/accounts.service'
import { FakeClock, FakeIssuer, FakeStore } from '../oauth-connections/oauth-connections.fakes'
import { OauthConnectionsService } from '../oauth-connections/oauth-connections.service'
import type { ProviderHttp } from './provider-http'
import { PASTE_ATTEMPT_TTL_MS, ProviderSignInService } from './provider-sign-in.service'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const API_URL = 'https://api.example.test'
const USER = 'user-a'
const OTHER = 'user-b'
const START = Date.parse('2026-10-30T12:00:00.000Z')

type Call = { url: string; body: string }

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`

class StubHttp implements ProviderHttp {
  nowMs = START
  readonly calls: Call[] = []
  readonly answers: Response[] = []
  readonly fetch: ProviderFetch = async (input, init) => {
    this.calls.push({ url: input, body: String(init.body) })
    const next = this.answers.shift()
    if (next === undefined) throw new Error(`unexpected request to ${input}`)
    return next
  }
  now(): number {
    return this.nowMs
  }
  answer(status: number, body: unknown): void {
    this.answers.push(new Response(JSON.stringify(body), { status }))
  }
}

describe('ProviderSignInService', () => {
  const database = useTestDatabase()
  let http: StubHttp
  let store: FakeStore
  let service: ProviderSignInService

  beforeEach(async () => {
    for (const id of [USER, OTHER]) await seedUser({ db: database().db, id })
    http = new StubHttp()
    store = new FakeStore()
    const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))
    const connections = new OauthConnectionsService(
      store,
      cipher,
      new FakeIssuer(),
      new FakeClock(START),
    )
    service = new ProviderSignInService(
      cipher,
      http,
      new EnvService({ BETTER_AUTH_URL: API_URL }),
      new AccountsService(cipher),
      connections,
    )
  })

  const beginClaude = async () => {
    const begun = await service.begin({
      userId: USER,
      provider: EOauthProvider.Anthropic,
    })
    if (begun.flow !== EProviderSignInFlow.PasteCode) throw new Error('expected paste-code')
    return begun
  }

  it('begins Claude with a manual-paste authorize URL and keeps the verifier out of it', async () => {
    const begun = await beginClaude()
    const url = new URL(begun.authorizeUrl)

    expect(url.origin + url.pathname).toBe('https://claude.com/cai/oauth/authorize')
    expect(url.searchParams.get('code')).toBe('true')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(begun.expiresInMs).toBe(PASTE_ATTEMPT_TTL_MS)
    expect(http.calls).toEqual([])
  })

  it('exchanges the pasted code#state into an active account owned by a cloud connection', async () => {
    const begun = await beginClaude()
    const state = new URL(begun.authorizeUrl).searchParams.get('state')
    http.answer(200, {
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
      scope: 'user:inference user:profile',
      account: { email_address: 'dev@example.com', subscription_type: 'max' },
    })

    const account = await service.complete({
      userId: USER,
      attemptId: begun.attemptId,
      code: `the-code#${state}`,
    })

    const sent = JSON.parse(http.calls[0]?.body ?? '{}') as Record<string, string>
    expect(http.calls[0]?.url).toBe('https://platform.claude.com/v1/oauth/token')
    expect(sent.code).toBe('the-code')
    expect(sent.redirect_uri).toBe('https://platform.claude.com/oauth/code/callback')
    expect(sent.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(account).toMatchObject({
      provider: 'anthropic',
      kind: EAuthKind.Oauth,
      label: 'dev@example.com',
      subscription: 'max',
    })

    const [connection] = [...store.rows.values()]
    expect(connection?.userId).toBe(USER)
    const stored = await new AccountsService(
      new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY })),
    ).read({ userId: USER, accountId: account.id })
    expect(stored.secret).toMatchObject({
      kind: EAuthKind.Oauth,
      tokens: { accessToken: 'access-1', refreshToken: '' },
      authority: { url: API_URL, connectionId: connection?.id, generation: 0 },
    })
    const pointer = await db.orm.public.ActiveAccount.first({
      userId: USER,
      provider: 'anthropic',
    })
    expect(pointer?.accountId).toBe(account.id)
  })

  it('replaces the same-email Claude account instead of adding a second', async () => {
    const signIn = async (access: string) => {
      const begun = await beginClaude()
      http.answer(200, {
        access_token: access,
        refresh_token: 'r',
        account: { email_address: 'dev@example.com' },
      })
      return service.complete({
        userId: USER,
        attemptId: begun.attemptId,
        code: 'c',
      })
    }

    const first = await signIn('a-1')
    const second = await signIn('a-2')

    expect(second.id).toBe(first.id)
    expect(store.rows.size).toBe(1)
    expect(await db.orm.public.AgentAccount.where({ userId: USER }).all()).toHaveLength(1)
  })

  it('refuses a tampered state, another user, and an expired attempt', async () => {
    const begun = await beginClaude()

    await expect(
      service.complete({
        userId: USER,
        attemptId: begun.attemptId,
        code: 'c#wrong',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      service.complete({
        userId: OTHER,
        attemptId: begun.attemptId,
        code: 'c',
      }),
    ).rejects.toThrow(/not recognised/)
    await expect(
      service.complete({ userId: USER, attemptId: 'psi_garbage', code: 'c' }),
    ).rejects.toThrow(/not recognised/)

    http.nowMs = START + PASTE_ATTEMPT_TTL_MS + 1
    await expect(
      service.complete({ userId: USER, attemptId: begun.attemptId, code: 'c' }),
    ).rejects.toThrow(/expired/)
    expect(http.calls).toEqual([])
  })

  it('maps a refused code to a 400 the user can act on', async () => {
    const begun = await beginClaude()
    http.answer(400, { error: 'invalid_grant' })

    await expect(
      service.complete({ userId: USER, attemptId: begun.attemptId, code: 'c' }),
    ).rejects.toThrow(/refused that code/)
  })

  it('runs the ChatGPT device flow: code, pending polls, then the account', async () => {
    http.answer(200, {
      device_auth_id: 'da-1',
      user_code: 'ABCD-1234',
      interval: '5',
    })
    const begun = await service.begin({
      userId: USER,
      provider: EOauthProvider.OpenAI,
    })
    if (begun.flow !== EProviderSignInFlow.DeviceCode) throw new Error('expected device-code')

    expect(begun).toMatchObject({
      userCode: 'ABCD-1234',
      verificationUrl: 'https://auth.openai.com/codex/device',
      intervalMs: 5000,
    })
    expect(begun.attemptId).not.toContain('da-1')

    http.answer(403, {})
    expect(await service.poll({ userId: USER, attemptId: begun.attemptId })).toEqual({
      status: EProviderSignInPoll.Pending,
    })

    http.answer(200, { authorization_code: 'ac', code_verifier: 'cv' })
    http.answer(200, {
      id_token: jwt({
        email: 'gpt@example.com',
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'acct-1',
          chatgpt_plan_type: 'pro',
        },
      }),
      access_token: 'oa-access',
      refresh_token: 'oa-refresh',
      expires_in: 3600,
    })
    const done = await service.poll({
      userId: USER,
      attemptId: begun.attemptId,
    })

    expect(done.status).toBe(EProviderSignInPoll.Complete)
    if (done.status !== EProviderSignInPoll.Complete) return
    expect(done.account).toMatchObject({
      provider: 'openai',
      kind: EAuthKind.Oauth,
      email: 'gpt@example.com',
      subscription: 'pro',
    })
    expect(JSON.parse(http.calls[1]?.body ?? '{}')).toEqual({
      device_auth_id: 'da-1',
      user_code: 'ABCD-1234',
    })
  })

  it('reports an expired device attempt without calling OpenAI', async () => {
    http.answer(200, { device_auth_id: 'da-1', user_code: 'ABCD' })
    const begun = await service.begin({
      userId: USER,
      provider: EOauthProvider.OpenAI,
    })
    http.nowMs = START + begun.expiresInMs + 1

    expect(await service.poll({ userId: USER, attemptId: begun.attemptId })).toEqual({
      status: EProviderSignInPoll.Expired,
    })
    expect(http.calls).toHaveLength(1)
  })

  it('explains the ChatGPT setting when device sign-in is disabled', async () => {
    http.answer(404, {})

    await expect(service.begin({ userId: USER, provider: EOauthProvider.OpenAI })).rejects.toThrow(
      /Sign in with device code/,
    )
  })

  it('refuses to cross flows', async () => {
    const begun = await beginClaude()

    await expect(service.poll({ userId: USER, attemptId: begun.attemptId })).rejects.toThrow(
      /pasted code/,
    )
  })
})
