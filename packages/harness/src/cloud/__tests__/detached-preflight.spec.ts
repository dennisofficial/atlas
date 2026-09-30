import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { EAccountOrigin, EAuthKind, EAuthProvider } from '@dltech/atlas-core'

import { memoryAccountStore } from '../../credentials/account-store'
import { ATLAS_VAULT_KEY_NAME, ATLAS_VAULT_NAME } from '../../credentials/paths'
import { SystemClock } from '../../store/clock'
import { detachedLiftVerdict } from '../detached-preflight'

const KEY = 'ab'.repeat(32)

const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-preflight-'))
  writeFileSync(join(home, ATLAS_VAULT_KEY_NAME), `${KEY}\n`, { mode: 0o600 })
  writeFileSync(
    join(home, ATLAS_VAULT_NAME),
    `${JSON.stringify({ version: 1, accounts: [], active: {} })}\n`,
    { mode: 0o600 },
  )
  return home
}

describe('detachedLiftVerdict', () => {
  it('passes when the model routes to a provider with no auth account', async () => {
    const verdict = await detachedLiftVerdict({
      providerId: 'openai',
      accounts: memoryAccountStore({ clock: new SystemClock() }),
      home: scratchHome(),
    })
    expect(verdict.ok).toBe(true)
  })

  it('passes when the provider id is not an auth provider at all', async () => {
    const verdict = await detachedLiftVerdict({
      providerId: 'vercel-gateway',
      accounts: memoryAccountStore({ clock: new SystemClock() }),
      home: scratchHome(),
    })
    expect(verdict.ok).toBe(true)
  })

  it('passes when the provider id is undefined', async () => {
    const verdict = await detachedLiftVerdict({
      providerId: undefined,
      accounts: memoryAccountStore({ clock: new SystemClock() }),
      home: scratchHome(),
    })
    expect(verdict.ok).toBe(true)
  })

  it('refuses the OAuth account the credential port would choose even without an active pointer', async () => {
    const home = scratchHome()
    const accounts = memoryAccountStore({ clock: new SystemClock() })
    await accounts.add({
      provider: EAuthProvider.Anthropic,
      label: 'claude-subscription',
      secret: {
        kind: EAuthKind.Oauth,
        tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: '2027-01-01T00:00:00.000Z' },
      },
      origin: EAccountOrigin.Login,
    })

    const verdict = await detachedLiftVerdict({ providerId: 'anthropic', accounts, home })

    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.refusal).toContain('claude-subscription')
      expect(verdict.refusal).toContain('API-key')
      expect(verdict.refusal).toContain('anthropic')
    }
  })

  it('passes when the chosen account is an API key', async () => {
    const home = scratchHome()
    const accounts = memoryAccountStore({ clock: new SystemClock() })
    await accounts.add({
      provider: EAuthProvider.Anthropic,
      label: 'anthropic-key',
      secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-ant-test' },
      origin: EAccountOrigin.Login,
    })

    const verdict = await detachedLiftVerdict({ providerId: 'anthropic', accounts, home })
    expect(verdict.ok).toBe(true)
  })

  it('refuses the active OAuth account even when an API key also exists for the provider', async () => {
    const home = scratchHome()
    const accounts = memoryAccountStore({ clock: new SystemClock() })
    await accounts.add({
      provider: EAuthProvider.Anthropic,
      label: 'anthropic-key',
      secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-ant-test' },
      origin: EAccountOrigin.Login,
    })
    const oauth = await accounts.add({
      provider: EAuthProvider.Anthropic,
      label: 'claude-subscription',
      secret: {
        kind: EAuthKind.Oauth,
        tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: '2027-01-01T00:00:00.000Z' },
      },
      origin: EAccountOrigin.Login,
    })
    await accounts.setActive({ provider: EAuthProvider.Anthropic, accountId: oauth.id })

    const verdict = await detachedLiftVerdict({ providerId: 'anthropic', accounts, home })

    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.refusal).toContain('claude-subscription')
  })
})
