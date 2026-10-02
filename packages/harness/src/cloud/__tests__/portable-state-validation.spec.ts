import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { SecretCipher } from '../../credentials/secret-cipher'
import { capturePortableState, materializePortableState } from '../portable-state'
import { OAUTH_TOKENS, openHome, seedSource, type PortableHome } from './portable-state-fixture'

describe('portable state validation', () => {
  let source: PortableHome
  let target: PortableHome

  beforeEach(() => {
    source = openHome()
    target = openHome()
  })

  afterEach(() => {
    rmSync(source.directory, { recursive: true, force: true })
    rmSync(target.directory, { recursive: true, force: true })
  })

  it('rejects a snapshot whose encrypted secret is an OAuth grant under api-key metadata, before any write', async () => {
    await seedSource({ source })
    const state = await capturePortableState({ home: source.directory })

    const oauthPlaintext = JSON.stringify({ kind: 'oauth', tokens: OAUTH_TOKENS })
    const sealed = new SecretCipher(join(target.directory, 'smuggle-key'))
    const blob = sealed.encrypt(oauthPlaintext)

    const smuggled = {
      ...state,
      vaultKeyHex: readFileSync(join(target.directory, 'smuggle-key'), 'utf8').trim(),
      accounts: [
        {
          id: 'acc_smuggled',
          provider: 'anthropic',
          kind: 'api-key',
          origin: 'login',
          label: 'smuggled',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          secret: blob,
        },
      ],
      active: [],
    }

    await expect(materializePortableState({ state: smuggled, home: target.directory })).rejects.toThrow()
    expect(existsSync(join(target.directory, 'key'))).toBe(false)
    expect(existsSync(join(target.directory, 'auth.json'))).toBe(false)
  })

  it('rejects a snapshot whose settings or mcp content is not valid for its schema, before any write', async () => {
    await seedSource({ source })
    const state = await capturePortableState({ home: source.directory })

    const badSettings = { ...state, settings: { name: 'settings.json' as const, content: '{ not json' } }
    await expect(materializePortableState({ state: badSettings, home: target.directory })).rejects.toThrow()
    expect(existsSync(join(target.directory, 'key'))).toBe(false)

    const badMcp = { ...state, mcp: { name: 'mcp.json' as const, content: '["array-not-object"]' } }
    const withoutSettings = { ...badMcp, settings: undefined }
    await expect(materializePortableState({ state: withoutSettings, home: target.directory })).rejects.toThrow()
    expect(existsSync(join(target.directory, 'key'))).toBe(false)
    expect(existsSync(join(target.directory, 'mcp.json'))).toBe(false)
  })

  it('refuses an OAuth account still holding a refresh token, and an MCP OAuth secret, before any write', async () => {
    await seedSource({ source })
    const state = await capturePortableState({ home: source.directory })

    const sealed = new SecretCipher(join(source.directory, 'key'))
    const oauthWithRefresh = sealed.encrypt(JSON.stringify({ kind: 'oauth', tokens: OAUTH_TOKENS }))
    const withOauth = {
      ...state,
      vaultKeyHex: readFileSync(join(source.directory, 'key'), 'utf8').trim(),
      accounts: [
        {
          id: 'acc_smuggled',
          provider: 'anthropic',
          kind: 'oauth',
          origin: 'login',
          label: 'smuggled',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          secret: oauthWithRefresh,
        },
      ],
    }
    await expect(materializePortableState({ state: withOauth, home: target.directory })).rejects.toThrow()
    expect(existsSync(join(target.directory, 'key'))).toBe(false)

    const withMcpOauth = {
      ...state,
      secrets: [...state.secrets, { name: 'mcp-oauth:linear', value: state.secrets[0]!.value }],
    }
    await expect(materializePortableState({ state: withMcpOauth, home: target.directory })).rejects.toThrow()
    expect(existsSync(join(target.directory, 'key'))).toBe(false)
    expect(existsSync(join(target.directory, 'secrets.json'))).toBe(false)
  })

  it('rejects a malformed snapshot before a single byte lands', async () => {
    const attempts: unknown[] = [
      null,
      'not json',
      { version: 2 },
      { version: 1, vaultKeyHex: 'not-hex', accounts: [], active: [], secrets: [] },
      {
        version: 1,
        vaultKeyHex: 'a'.repeat(64),
        accounts: [],
        active: [{ provider: 'anthropic', accountId: 'acc_missing' }],
        secrets: [],
      },
    ]

    for (const state of attempts) {
      await expect(materializePortableState({ state, home: target.directory })).rejects.toThrow(
        /portable-state snapshot/,
      )
      expect(existsSync(join(target.directory, 'key'))).toBe(false)
      expect(existsSync(join(target.directory, 'auth.json'))).toBe(false)
    }
  })

  it('rejects a snapshot whose sealed blobs do not open under its own key, before any write', async () => {
    await seedSource({ source })
    const state = await capturePortableState({ home: source.directory })
    const tampered = {
      ...state,
      accounts: state.accounts.map((account, index) =>
        index === 0 ? { ...account, secret: account.secret.slice(0, -4) + 'AAAA' } : account,
      ),
    }

    await expect(materializePortableState({ state: tampered, home: target.directory })).rejects.toThrow()
    expect(existsSync(join(target.directory, 'key'))).toBe(false)
    expect(existsSync(join(target.directory, 'auth.json'))).toBe(false)
    expect(existsSync(join(target.directory, 'settings.json'))).toBe(false)
  })
})
