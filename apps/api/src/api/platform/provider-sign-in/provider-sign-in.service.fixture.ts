import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import type { ProviderFetch } from '@dltech/atlas-credentials/provider-oauth'
import { beforeEach } from 'bun:test'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { AccountsService } from '../accounts/accounts.service'
import { InProcessRefreshLock } from '../../../_lib/refresh-lock/refresh-lock'
import { FakeClock, FakeIssuer, FakeStore } from '../oauth-connections/oauth-connections.fakes'
import { OauthConnectionsService } from '../oauth-connections/oauth-connections.service'
import type { ProviderHttp } from './provider-http'
import { ProviderSignInService } from './provider-sign-in.service'

export const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
export const API_URL = 'https://api.example.test'
export const USER = 'user-a'
export const OTHER = 'user-b'
export const START = Date.parse('2026-10-30T12:00:00.000Z')

type Call = { url: string; body: string }

export const jwt = (claims: object) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`

export class StubHttp implements ProviderHttp {
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

export type SignInHarness = {
  http: StubHttp
  store: FakeStore
  service: ProviderSignInService
}

export const useProviderSignIn = (): (() => SignInHarness) => {
  const database = useTestDatabase()
  let harness: SignInHarness | null = null

  beforeEach(async () => {
    for (const id of [USER, OTHER]) await seedUser({ db: database().db, id })
    const http = new StubHttp()
    const store = new FakeStore()
    const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))
    const connections = new OauthConnectionsService(
      store,
      cipher,
      new FakeIssuer(),
      new FakeClock(START),
      new InProcessRefreshLock(),
    )
    const service = new ProviderSignInService(
      cipher,
      http,
      new EnvService({ BETTER_AUTH_URL: API_URL }),
      new AccountsService(cipher),
      connections,
    )
    harness = { http, store, service }
  })

  return () => {
    if (harness === null) throw new Error('the sign-in harness runs only inside a test')
    return harness
  }
}
