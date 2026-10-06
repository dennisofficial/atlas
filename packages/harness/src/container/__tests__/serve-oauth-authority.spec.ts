import { describe, expect, it } from 'bun:test'

import { AccountStorePort, CredentialPort, EAccountOrigin, EAuthKind, EAuthProvider } from '@dltech/atlas-core'

import { createHarnessContainer } from '../create-harness-container'
import { disposeAll } from '../disposal'
import { portToken } from '../injection'
import { CloudSessionStoreToken, ServeSessionToken } from '../tokens'

it('resolves cloud-owned OAuth through the served sandbox principal without uploading or storing a user session', async () => {
  const original = globalThis.fetch
  const calls: Array<{ url: string; method: string; authorization: string | null }> = []
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', authorization: new Headers(init?.headers).get('authorization') })
    return Response.json({ accessToken: 'fake-served-access', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), generation: 1, authorizationId: 'oauth-served' })
  }, { preconnect: () => undefined })
  const container = createHarnessContainer()
  container.register(ServeSessionToken, { useValue: { url: 'https://api.test', token: 'fake-sandbox-principal', email: null } })
  try {
    const accounts = container.resolve(portToken(AccountStorePort))
    const account = await accounts.add({
      provider: EAuthProvider.Anthropic, label: 'served', origin: EAccountOrigin.Login,
      secret: { kind: EAuthKind.Oauth, tokens: { accessToken: 'fake-expired', refreshToken: '', expiresAt: '2000-01-01T00:00:00.000Z' }, authority: { url: 'https://api.test', connectionId: 'oauth-served' } },
    })
    const credential = await container.resolve(portToken(CredentialPort)).read({ accountId: account.id, provider: EAuthProvider.Anthropic })
    expect(credential).toMatchObject({ accountId: account.id, accessToken: 'fake-served-access' })
    expect(calls).toEqual([{ url: 'https://api.test/v1/oauth-connections/oauth-served/access-token', method: 'POST', authorization: 'Bearer fake-sandbox-principal' }])
    expect(container.resolve(CloudSessionStoreToken).read()).toBeNull()
    const stored = await accounts.read(account.id)
    if (stored?.secret.kind !== EAuthKind.Oauth) throw new Error('served OAuth missing')
    expect(stored.secret.tokens.refreshToken).toBe('')
  } finally {
    globalThis.fetch = original
    await disposeAll({ container })
  }
})
