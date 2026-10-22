import { describe, expect, it } from 'bun:test'

import { EAccountOrigin, EAuthKind, EAuthProvider, type Account, type AccountSecret } from '@dltech/atlas-core'

import { memoryAccountStore } from '../account-store'
import { AccountsService } from '../accounts-service'
import { AnthropicOauthClient } from '../oauth'

const clock = { now: () => '2026-10-05T12:00:00.000Z' }
const secret: AccountSecret = { kind: EAuthKind.Oauth, tokens: {
  accessToken: 'fake-old-access', refreshToken: 'fake-old-refresh', expiresAt: '2026-10-05T13:00:00.000Z',
} }

const setup = (onOauthLogin: (account: Account) => Promise<void>) => {
  const accounts = memoryAccountStore({ clock })
  const client = new AnthropicOauthClient({
    clock,
    fetch: async () => Response.json({ access_token: 'fake-new-access', refresh_token: 'fake-new-refresh', expires_in: 3600, account: { email_address: 'native@example.test' } }),
  })
  return { accounts, service: new AccountsService({ accounts, clients: { [EAuthProvider.Anthropic]: client }, onOauthLogin }) }
}

const signIn = (service: AccountsService) => service.complete({ ticket: service.begin(EAuthProvider.Anthropic), pasted: 'fake-code' })

describe('native OAuth login handoff', () => {
  it('awaits handoff after the new native grant is in Atlas storage', async () => {
    let called: Account | undefined
    const { accounts, service } = setup(async (account) => {
      called = account
      const stored = await accounts.read(account.id)
      expect(stored?.secret.kind).toBe(EAuthKind.Oauth)
      if (stored?.secret.kind === EAuthKind.Oauth) expect(stored.secret.tokens.refreshToken).toBe('fake-new-refresh')
    })
    const account = await signIn(service)
    expect(called?.id).toBe(account.id)
  })

  it('does not invoke OAuth handoff for API-key login', async () => {
    let called = false
    const { service } = setup(async () => { called = true })
    await service.addApiKey({ provider: EAuthProvider.OpenRouter, apiKey: 'fake-key' })
    expect(called).toBe(false)
  })

  it('replaces a CLI-imported account with a native row on explicit reauthorization', async () => {
    const { accounts, service } = setup(async () => {})
    const imported = await accounts.add({ provider: EAuthProvider.Anthropic, label: 'native@example.test', email: 'native@example.test', origin: EAccountOrigin.Imported, importedFrom: 'claude-code', secret })
    const account = await signIn(service)
    expect(account.id).not.toBe(imported.id)
    expect(account.origin).toBe(EAccountOrigin.Login)
    expect(account.importedFrom).toBeUndefined()
    expect(await accounts.read(imported.id)).toBeUndefined()
    expect(await accounts.list()).toHaveLength(1)
  })

  it('keeps native account identity on reauthorization and removes the previous authority', async () => {
    const { accounts, service } = setup(async () => {})
    const original = await accounts.add({ provider: EAuthProvider.Anthropic, label: 'native@example.test', email: 'native@example.test', origin: EAccountOrigin.Login, secret: {
      ...secret,
      authority: { url: 'https://cloud.test', connectionId: 'oauth-old-grant' },
    } })
    const account = await signIn(service)
    expect(account.id).toBe(original.id)
    const stored = await accounts.read(account.id)
    if (stored?.secret.kind !== EAuthKind.Oauth) throw new Error('OAuth account missing')
    expect(stored.secret.authority).toBeUndefined()
    expect(stored.secret.tokens.refreshToken).toBe('fake-new-refresh')
  })

  it('reports handoff failure without discarding the newly authorized grant', async () => {
    const { accounts, service } = setup(async () => { throw new Error('handoff unavailable') })
    await expect(signIn(service)).rejects.toThrow('handoff unavailable')
    expect(await accounts.list()).toHaveLength(1)
  })
})
