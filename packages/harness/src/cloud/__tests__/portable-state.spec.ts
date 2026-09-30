import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  PORTABLE_ACCOUNT_KIND,
  PORTABLE_MCP_NAME,
  PORTABLE_SETTINGS_NAME,
} from '@dltech/atlas-wire'
import {
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  toAccountId,
  type ClockPort,
} from '@dltech/atlas-core'

import { fileAccountStore, type AccountStore } from '../../credentials/account-store'
import { ATLAS_MCP_FILE_NAME, ATLAS_SETTINGS_NAME } from '../../settings/paths'
import { SecretCipher } from '../../credentials/secret-cipher'
import { FileSecretsStore } from '../../secrets/file-secrets-store'
import { captureDetachedPreflight, capturePortableState, materializePortableState } from '../portable-state'

const clock: ClockPort = { now: () => '2026-01-01T00:00:00.000Z' }

const OAUTH_TOKENS = {
  accessToken: 'fake-access-token',
  refreshToken: 'fake-refresh-token',
  expiresAt: '2026-06-01T00:00:00.000Z',
}

const mode = (path: string): number => statSync(path).mode & 0o777

type Home = { directory: string; store: AccountStore; cipher: SecretCipher }

const openHome = (): Home => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-portable-'))
  const store = fileAccountStore({
    file: join(directory, 'auth.json'),
    keyFile: join(directory, 'key'),
    clock,
  })
  return { directory, store, cipher: new SecretCipher(join(directory, 'key')) }
}

describe('portable state', () => {
  let source: Home
  let target: Home

  beforeEach(() => {
    source = openHome()
    target = openHome()
  })

  afterEach(() => {
    rmSync(source.directory, { recursive: true, force: true })
    rmSync(target.directory, { recursive: true, force: true })
  })

  const seedSource = async (): Promise<{ envAccountId: string; oauthAccountId: string }> => {
    const oauth = await source.store.add({
      provider: EAuthProvider.Anthropic,
      label: 'Claude subscription',
      secret: { kind: EAuthKind.Oauth, tokens: OAUTH_TOKENS },
      origin: EAccountOrigin.Imported,
      importedFrom: 'claude-code',
      subscription: 'max',
    })
    const env = await source.store.add({
      provider: EAuthProvider.OpenAI,
      label: 'OpenAI (OPENAI_API_KEY)',
      secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-fake-env-key' },
      origin: EAccountOrigin.Environment,
      importedFrom: 'environment:OPENAI_API_KEY',
    })
    const apiKey = await source.store.add({
      provider: EAuthProvider.OpenRouter,
      label: 'OpenRouter',
      secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-or-fake' },
      origin: EAccountOrigin.Login,
    })
    await source.store.setActive({ provider: EAuthProvider.Anthropic, accountId: oauth.id })
    await source.store.setActive({ provider: EAuthProvider.OpenAI, accountId: env.id })

    const secrets = new FileSecretsStore({
      file: join(source.directory, 'secrets.json'),
      cipher: source.cipher,
    })
    secrets.write({ name: 'LINEAR_API_KEY', value: 'lin_fake_value' })
    secrets.write({ name: 'mcp-oauth:linear', value: '{"refreshToken":"fake-mcp-refresh"}' })
    secrets.write({ name: 'sandbox-serve:th_fake_thread', value: 'fake-attachment-token' })

    writeFileSync(join(source.directory, 'settings.json'), '{"theme":"dark"}\n')
    writeFileSync(
      join(source.directory, 'mcp.json'),
      '{"linear":{"transport":{"kind":"stdio","command":"fake-mcp-server"}}}\n',
    )

    void apiKey
    return { envAccountId: env.id, oauthAccountId: oauth.id }
  }

  it('round-trips API-key accounts, their active pointers, secrets, settings and MCP into a fresh home', async () => {
    const seeded = await seedSource()
    const state = await capturePortableState({ home: source.directory })

    const install = await materializePortableState({ state, home: target.directory })

    expect(install.written.length).toBeGreaterThan(0)
    expect(install.skipped).toEqual([])

    const accounts = await target.store.list()
    expect(accounts.map((account) => account.label).sort()).toEqual([
      'OpenAI (OPENAI_API_KEY)',
      'OpenRouter',
    ])

    const restored = await target.store.read(accounts.find((a) => a.label === 'OpenRouter')!.id)
    expect(restored?.secret).toEqual({ kind: EAuthKind.ApiKey, apiKey: 'sk-or-fake' })

    expect(await target.store.activeFor(EAuthProvider.OpenAI)).toBe(toAccountId(seeded.envAccountId))

    const secrets = new FileSecretsStore({
      file: join(target.directory, 'secrets.json'),
      cipher: new SecretCipher(join(target.directory, 'key')),
    })
    expect(secrets.read('LINEAR_API_KEY')).toBe('lin_fake_value')
    expect(secrets.read('mcp-oauth:linear')).toBeUndefined()

    expect(readFileSync(join(target.directory, 'settings.json'), 'utf8')).toContain('"theme":"dark"')
    expect(readFileSync(join(target.directory, 'mcp.json'), 'utf8')).toContain('linear')
  })

  it('omits OAuth accounts and MCP OAuth secrets, naming them without values', async () => {
    await seedSource()
    const state = await capturePortableState({ home: source.directory })

    expect(state.accounts.every((account) => account.kind === 'api-key')).toBe(true)
    expect(state.omitted?.oauthAccounts).toEqual(['Claude subscription'])
    expect(state.omitted?.mcpOauthSecrets).toEqual(['mcp-oauth:linear'])
    expect(JSON.stringify(state)).not.toContain('fake-mcp-refresh')
    expect(JSON.stringify(state)).not.toContain('fake-access-token')

    const activeProviders = state.active.map((pointer) => pointer.provider)
    expect(activeProviders).not.toContain('anthropic')
    expect(activeProviders).toContain('openai')
  })

  it('never clones an attachment token minted before the lift into the sandbox', async () => {
    await seedSource()
    const state = await capturePortableState({ home: source.directory })

    expect(state.secrets.map((secret) => secret.name)).toEqual(['LINEAR_API_KEY'])
    expect(state.omitted?.attachmentTokens).toEqual(['sandbox-serve:th_fake_thread'])
    expect(JSON.stringify(state)).not.toContain('fake-attachment-token')

    await materializePortableState({ state, home: target.directory })
    const secrets = new FileSecretsStore({
      file: join(target.directory, 'secrets.json'),
      cipher: new SecretCipher(join(target.directory, 'key')),
    })
    expect(secrets.read('sandbox-serve:th_fake_thread')).toBeUndefined()
    expect(secrets.read('LINEAR_API_KEY')).toBe('lin_fake_value')
  })

  it('captures with a fresh sandbox key, never the home\'s master key', async () => {
    await seedSource()
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

    await materializePortableState({ state, home: target.directory })
    const restored = await target.store.read(
      (await target.store.list()).find((held) => held.label === 'OpenRouter')!.id,
    )
    expect(restored?.secret).toEqual({ kind: EAuthKind.ApiKey, apiKey: 'sk-or-fake' })
  })

  it('rejects a snapshot whose encrypted secret is an OAuth grant under api-key metadata, before any write', async () => {
    await seedSource()
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
    await seedSource()
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

  it('throws a path-only error when a credential file exists but cannot be read', async () => {
    await seedSource()
    chmodSync(join(source.directory, 'settings.json'), 0o000)

    await expect(capturePortableState({ home: source.directory })).rejects.toThrow(
      join(source.directory, 'settings.json'),
    )
  })

  it('reports a selected OAuth account as not liftable and a selected API-key account as fine', async () => {
    const seeded = await seedSource()

    const blocked = await captureDetachedPreflight({
      home: source.directory,
      selectedAccountId: seeded.oauthAccountId,
    })
    expect(blocked).toEqual({ ok: false, label: 'Claude subscription' })

    const fine = await captureDetachedPreflight({
      home: source.directory,
      selectedAccountId: seeded.envAccountId,
    })
    expect(fine).toEqual({ ok: true })

    expect(await captureDetachedPreflight({ home: source.directory })).toEqual({ ok: true })
  })

  it('refuses a payload that smuggles an OAuth grant or an MCP OAuth secret, before any write', async () => {
    await seedSource()
    const state = await capturePortableState({ home: source.directory })

    const withOauth = {
      ...state,
      accounts: [
        ...state.accounts,
        {
          id: 'acc_smuggled',
          provider: 'anthropic',
          kind: 'oauth',
          origin: 'login',
          label: 'smuggled',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          secret: state.accounts[0]!.secret,
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

  it('keeps the payload sealed: no plaintext token or secret appears in the snapshot JSON', async () => {
    await seedSource()
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
    await seedSource()
    const state = await capturePortableState({ home: source.directory })

    const envAccount = state.accounts.find((account) => account.label === 'OpenAI (OPENAI_API_KEY)')
    expect(envAccount?.origin).toBe('login')
    expect(envAccount?.source).toEqual({ kind: 'environment', detail: 'OPENAI_API_KEY' })
    expect(JSON.stringify(state.accounts)).not.toContain('importedFrom')
  })

  it('writes every installed file owner-only', async () => {
    await seedSource()
    const state = await capturePortableState({ home: source.directory })
    await materializePortableState({ state, home: target.directory })

    for (const name of ['key', 'auth.json', 'secrets.json', 'settings.json', 'mcp.json']) {
      expect(mode(join(target.directory, name))).toBe(0o600)
    }
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
    await seedSource()
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

  it('never overwrites a live vault on resume, preserving a locally rotated key', async () => {
    await seedSource()
    const state = await capturePortableState({ home: source.directory })

    await materializePortableState({ state, home: target.directory })

    const account = (await target.store.list()).find((held) => held.label === 'OpenRouter')!
    await target.store.replaceSecret({
      accountId: account.id,
      secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-or-rotated' },
    })

    const install = await materializePortableState({ state, home: target.directory })

    expect(install.skipped).toContain(join(target.directory, 'auth.json'))
    expect(install.skipped).toContain(join(target.directory, 'key'))
    const after = await target.store.read(account.id)
    expect(after?.secret).toEqual({ kind: EAuthKind.ApiKey, apiKey: 'sk-or-rotated' })
  })

  it('installs explicitly when overwriteExisting is set', async () => {
    await seedSource()
    const state = await capturePortableState({ home: source.directory })
    await materializePortableState({ state, home: target.directory })

    const account = (await target.store.list()).find((held) => held.label === 'OpenRouter')!
    await target.store.replaceSecret({
      accountId: account.id,
      secret: { kind: EAuthKind.ApiKey, apiKey: 'sk-or-rotated' },
    })

    const install = await materializePortableState({ state, home: target.directory, overwriteExisting: true })

    expect(install.written).toContain(join(target.directory, 'auth.json'))
    const restored = (await target.store.list()).find((held) => held.label === 'OpenRouter')!
    const read = await target.store.read(restored.id)
    expect(read?.secret).toEqual({ kind: EAuthKind.ApiKey, apiKey: 'sk-or-fake' })
  })

  it('captures nothing from cloud.json or another home', async () => {
    await seedSource()
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

  it('respects an explicit file permission repair: chmod stays owner-only after install', async () => {
    await seedSource()
    const state = await capturePortableState({ home: source.directory })
    writeFileSync(join(target.directory, 'settings.json'), '{"theme":"light"}\n')
    chmodSync(join(target.directory, 'settings.json'), 0o644)

    const install = await materializePortableState({ state, home: target.directory })

    expect(install.skipped).toContain(join(target.directory, 'settings.json'))
    expect(readFileSync(join(target.directory, 'settings.json'), 'utf8')).toContain('"theme":"light"')
  })

  it('wire name constants equal the harness file names they write under', () => {
    expect(PORTABLE_SETTINGS_NAME).toBe(ATLAS_SETTINGS_NAME)
    expect(PORTABLE_MCP_NAME).toBe(ATLAS_MCP_FILE_NAME)
    expect(PORTABLE_ACCOUNT_KIND).toBe(EAuthKind.ApiKey)
  })

  it('installs accounts into a key-only home by resealing under the existing key', async () => {
    await seedSource()
    const state = await capturePortableState({ home: source.directory })

    const keylessTarget = mkdtempSync(join(tmpdir(), 'atlas-portable-keyonly-'))
    try {
      const homeCipher = new SecretCipher(join(keylessTarget, 'key'))
      homeCipher.encrypt('warmup')
      const homeKeyHex = readFileSync(join(keylessTarget, 'key'), 'utf8').trim()
      expect(homeKeyHex).not.toBe(state.vaultKeyHex)

      const install = await materializePortableState({ state, home: keylessTarget })

      expect(install.skipped).toContain(join(keylessTarget, 'key'))
      expect(install.written).toContain(join(keylessTarget, 'auth.json'))
      expect(readFileSync(join(keylessTarget, 'key'), 'utf8').trim()).toBe(homeKeyHex)

      const store = fileAccountStore({
        file: join(keylessTarget, 'auth.json'),
        keyFile: join(keylessTarget, 'key'),
        clock,
      })
      const accounts = await store.list()
      expect(accounts.map((account) => account.label).sort()).toEqual([
        'OpenAI (OPENAI_API_KEY)',
        'OpenRouter',
      ])
      const restored = await store.read(accounts.find((a) => a.label === 'OpenRouter')!.id)
      expect(restored?.secret).toEqual({ kind: EAuthKind.ApiKey, apiKey: 'sk-or-fake' })
      expect(await store.activeFor(EAuthProvider.OpenAI)).toBeDefined()

      const secrets = new FileSecretsStore({
        file: join(keylessTarget, 'secrets.json'),
        cipher: homeCipher,
      })
      expect(secrets.read('LINEAR_API_KEY')).toBe('lin_fake_value')
    } finally {
      rmSync(keylessTarget, { recursive: true, force: true })
    }
  })

  it('installs secrets into a vault-only home by resealing under the existing key', async () => {
    await seedSource()
    const state = await capturePortableState({ home: source.directory })

    const secretsOnly = mkdtempSync(join(tmpdir(), 'atlas-portable-secretsonly-'))
    try {
      const store = fileAccountStore({
        file: join(secretsOnly, 'auth.json'),
        keyFile: join(secretsOnly, 'key'),
        clock,
      })
      await store.add({
        provider: EAuthProvider.Inference,
        label: 'existing-local',
        secret: { kind: EAuthKind.ApiKey, apiKey: 'inf-local' },
        origin: EAccountOrigin.Login,
      })
      const homeKeyHex = readFileSync(join(secretsOnly, 'key'), 'utf8').trim()

      const install = await materializePortableState({ state, home: secretsOnly })

      expect(install.skipped).toContain(join(secretsOnly, 'auth.json'))
      expect(install.skipped).toContain(join(secretsOnly, 'key'))
      expect(install.written).toContain(join(secretsOnly, 'secrets.json'))
      expect(readFileSync(join(secretsOnly, 'key'), 'utf8').trim()).toBe(homeKeyHex)

      const secrets = new FileSecretsStore({
        file: join(secretsOnly, 'secrets.json'),
        cipher: new SecretCipher(join(secretsOnly, 'key')),
      })
      expect(secrets.read('LINEAR_API_KEY')).toBe('lin_fake_value')
      expect(secrets.read('sandbox-serve:th_fake_thread')).toBeUndefined()

      const accounts = await store.list()
      expect(accounts.map((account) => account.label)).toEqual(['existing-local'])
      const local = await store.read(accounts[0]!.id)
      expect(local?.secret).toEqual({ kind: EAuthKind.ApiKey, apiKey: 'inf-local' })
    } finally {
      rmSync(secretsOnly, { recursive: true, force: true })
    }
  })

  it('refuses to install into a vault-only home whose key is missing', async () => {
    await seedSource()
    const state = await capturePortableState({ home: source.directory })

    const stranded = mkdtempSync(join(tmpdir(), 'atlas-portable-stranded-'))
    try {
      const store = fileAccountStore({
        file: join(stranded, 'auth.json'),
        keyFile: join(stranded, 'key'),
        clock,
      })
      await store.add({
        provider: EAuthProvider.Inference,
        label: 'stranded-local',
        secret: { kind: EAuthKind.ApiKey, apiKey: 'inf-stranded' },
        origin: EAccountOrigin.Login,
      })
      rmSync(join(stranded, 'key'))

      await expect(materializePortableState({ state, home: stranded })).rejects.toThrow(
        /no readable vault key/,
      )
      expect(existsSync(join(stranded, 'key'))).toBe(false)
      expect(existsSync(join(stranded, 'secrets.json'))).toBe(false)
    } finally {
      rmSync(stranded, { recursive: true, force: true })
    }
  })

  it('fails capture at the host when a local settings or MCP file is malformed', async () => {
    await seedSource()

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
})
