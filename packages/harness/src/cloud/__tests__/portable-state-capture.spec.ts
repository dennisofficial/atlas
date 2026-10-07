import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EAuthKind } from '@dltech/atlas-core'
import {
  PORTABLE_ACCOUNT_KIND,
  PORTABLE_MCP_NAME,
  PORTABLE_SETTINGS_NAME,
} from '@dltech/atlas-wire'

import { ATLAS_MCP_FILE_NAME, ATLAS_SETTINGS_NAME } from '../../settings/paths'
import {
  capturePortableState,
  materializePortableState,
} from '../portable-state'
import { itUnlessRoot } from '../../testing/root-unsafe'
import { openHome, openSecrets, seedSource, type PortableHome } from './portable-state-fixture'

describe('portable state capture', () => {
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

  it('carries OAuth accounts with the refresh token stripped, and omits MCP OAuth secrets', async () => {
    await seedSource({ source })
    const state = await capturePortableState({ home: source.directory })

    const oauth = state.accounts.find((account) => account.label === 'Claude subscription')
    expect(oauth?.kind).toBe('oauth')
    expect(state.omitted?.oauthAccounts).toEqual([])
    expect(state.omitted?.mcpOauthSecrets).toEqual(['mcp-oauth:linear'])
    expect(JSON.stringify(state)).not.toContain('fake-mcp-refresh')
    expect(JSON.stringify(state)).not.toContain('fake-refresh-token')

    const activeProviders = state.active.map((pointer) => pointer.provider)
    expect(activeProviders).toContain('anthropic')
    expect(activeProviders).toContain('openai')
  })

  it('never clones an attachment token minted before the lift into the sandbox', async () => {
    await seedSource({ source })
    const state = await capturePortableState({ home: source.directory })

    expect(state.secrets.map((secret) => secret.name)).toEqual(['LINEAR_API_KEY'])
    expect(state.omitted?.attachmentTokens).toEqual(['sandbox-serve:th_fake_thread'])
    expect(JSON.stringify(state)).not.toContain('fake-attachment-token')

    await materializePortableState({ state, home: target.directory })
    const secrets = openSecrets({ home: target })
    expect(secrets.read('sandbox-serve:th_fake_thread')).toBeUndefined()
    expect(secrets.read('LINEAR_API_KEY')).toBe('lin_fake_value')
  })

  it('captures with a fresh sandbox key, never the home\'s master key', async () => {
    await seedSource({ source })
    const homeKeyHex = readFileSync(join(source.directory, 'key'), 'utf8').trim()

    const state = await capturePortableState({ home: source.directory })

    expect(state.vaultKeyHex).toMatch(/^[0-9a-f]{64}$/)
    expect(state.vaultKeyHex).not.toBe(homeKeyHex)

    const rawVault = JSON.parse(readFileSync(join(source.directory, 'auth.json'), 'utf8')) as {
      accounts: { label: string; secret: string }[]
    }
    const homeSealed = rawVault.accounts.find((account) => account.label === 'OpenRouter')!.secret
    const carriedSealed = state.accounts.find((account) => account.label === 'OpenRouter')!.secret
    expect(carriedSealed).not.toBe(homeSealed)
  })

  itUnlessRoot('throws a path-only error when a credential file exists but cannot be read', async () => {
    await seedSource({ source })
    chmodSync(join(source.directory, 'settings.json'), 0o000)

    await expect(capturePortableState({ home: source.directory })).rejects.toThrow(
      join(source.directory, 'settings.json'),
    )
  })

  it('keeps the payload sealed: no plaintext token or secret appears in the snapshot JSON', async () => {
    await seedSource({ source })
    const state = await capturePortableState({ home: source.directory })

    const text = JSON.stringify(state)
    expect(text).not.toContain('fake-access-token')
    expect(text).not.toContain('fake-refresh-token')
    expect(text).not.toContain('sk-fake-env-key')
    expect(text).not.toContain('sk-or-fake')
    expect(text).not.toContain('lin_fake_value')
    expect(text).not.toContain('cloud.json')
  })

  it('sanitizes machine-local origins so environment sync never deletes a transferred account', async () => {
    await seedSource({ source })
    const state = await capturePortableState({ home: source.directory })

    const envAccount = state.accounts.find((account) => account.label === 'OpenAI (OPENAI_API_KEY)')
    expect(envAccount?.origin).toBe('login')
    expect(envAccount?.source).toEqual({ kind: 'environment', detail: 'OPENAI_API_KEY' })
    expect(JSON.stringify(state.accounts)).not.toContain('importedFrom')
  })

  it('captures nothing from cloud.json or another home', async () => {
    await seedSource({ source })
    writeFileSync(join(source.directory, 'cloud.json'), '{"token":"fake-cloud-signin"}')

    const state = await capturePortableState({ home: source.directory })
    expect(JSON.stringify(state)).not.toContain('fake-cloud-signin')

    const empty = await capturePortableState({ home: target.directory })
    expect(empty.accounts).toEqual([])
    expect(empty.secrets).toEqual([])
    expect(empty.settings).toBeUndefined()
  })

  it('mints a key into the payload for a home that has none, without touching that home', async () => {
    const state = await capturePortableState({ home: target.directory })
    expect(state.vaultKeyHex).toMatch(/^[0-9a-f]{64}$/)
    expect(existsSync(join(target.directory, 'key'))).toBe(false)
  })

  it('fails capture rather than carry secrets a keyless home cannot reseal', async () => {
    const keyless = mkdtempSync(join(tmpdir(), 'atlas-portable-keyless-'))
    try {
      writeFileSync(
        join(keyless, 'secrets.json'),
        JSON.stringify({ version: 1, secrets: { SOME_KEY: 'sealed-value' } }),
      )
      await expect(capturePortableState({ home: keyless })).rejects.toThrow(/no vault key/)
    } finally {
      rmSync(keyless, { recursive: true, force: true })
    }
  })

  it('fails capture at the host when a local settings or MCP file is malformed', async () => {
    await seedSource({ source })

    writeFileSync(join(source.directory, 'settings.json'), '{ not json')
    await expect(capturePortableState({ home: source.directory })).rejects.toThrow(/settings file/)
    writeFileSync(join(source.directory, 'settings.json'), '{"theme":{"nested":true}}')
    await expect(capturePortableState({ home: source.directory })).rejects.toThrow(/settings file/)
    writeFileSync(join(source.directory, 'settings.json'), '{"theme":"dark"}\n')

    writeFileSync(join(source.directory, 'mcp.json'), '["array"]')
    await expect(capturePortableState({ home: source.directory })).rejects.toThrow(/MCP file/)
    writeFileSync(join(source.directory, 'mcp.json'), '{"bad server!":{"command":"x"}}')
    await expect(capturePortableState({ home: source.directory })).rejects.toThrow(/MCP file/)
    writeFileSync(
      join(source.directory, 'mcp.json'),
      '{"linear":{"transport":{"kind":"stdio","command":"fake-mcp-server"}}}\n',
    )

    const state = await capturePortableState({ home: source.directory })
    expect(state.settings?.name).toBe('settings.json')
  })

  it('wire name constants equal the harness file names they write under', () => {
    expect(PORTABLE_SETTINGS_NAME).toBe(ATLAS_SETTINGS_NAME)
    expect(PORTABLE_MCP_NAME).toBe(ATLAS_MCP_FILE_NAME)
    expect(PORTABLE_ACCOUNT_KIND).toBe(EAuthKind.ApiKey)
  })
})

describe('portable state capture of excluded OAuth accounts', () => {
  it('replaces an excluded active OAuth secret with an expired placeholder and keeps its pointer', async () => {
    const source = openHome()
    try {
      const { oauthAccountId } = await seedSource({ source })
      const before = JSON.stringify(await source.store.list())
      const state = await capturePortableState({ home: source.directory, omitOauthAccountIds: [oauthAccountId] })

      const placeholder = state.accounts.find((account) => account.id === oauthAccountId)
      expect(placeholder?.status).toBe('expired')
      expect(placeholder?.label).toBe('Claude subscription')
      expect(state.omitted?.oauthAccounts).toEqual(['Claude subscription'])
      expect(state.active).toContainEqual({ provider: 'anthropic', accountId: oauthAccountId })
      expect(JSON.stringify(state)).not.toContain('fake-access-token')
      expect(JSON.stringify(state)).not.toContain('fake-refresh-token')
      expect(JSON.stringify(await source.store.list())).toBe(before)
    } finally {
      rmSync(source.directory, { recursive: true, force: true })
    }
  })
})
