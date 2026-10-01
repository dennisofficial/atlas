import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EAccountOrigin, EAuthKind, EAuthProvider, toAccountId } from '@dltech/atlas-core'

import { fileAccountStore } from '../../credentials/account-store'
import { SecretCipher } from '../../credentials/secret-cipher'
import { FileSecretsStore } from '../../secrets/file-secrets-store'
import { capturePortableState, materializePortableState } from '../portable-state'
import { clock, openHome, openSecrets, seedSource, type PortableHome } from './portable-state-fixture'

const mode = (path: string): number => statSync(path).mode & 0o777

describe('portable state installation', () => {
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

  it('round-trips API-key accounts, their active pointers, secrets, settings and MCP into a fresh home', async () => {
    const seeded = await seedSource({ source })
    const state = await capturePortableState({ home: source.directory })

    const install = await materializePortableState({ state, home: target.directory })

    expect(install.written.length).toBeGreaterThan(0)
    expect(install.skipped).toEqual([])

    const accounts = await target.store.list()
    expect(accounts.map((account) => account.label).sort()).toEqual([
      'Claude subscription',
      'OpenAI (OPENAI_API_KEY)',
      'OpenRouter',
    ])

    const restored = await target.store.read(accounts.find((a) => a.label === 'OpenRouter')!.id)
    expect(restored?.secret).toEqual({ kind: EAuthKind.ApiKey, apiKey: 'sk-or-fake' })

    expect(await target.store.activeFor(EAuthProvider.OpenAI)).toBe(toAccountId(seeded.envAccountId))

    const secrets = openSecrets({ home: target })
    expect(secrets.read('LINEAR_API_KEY')).toBe('lin_fake_value')
    expect(secrets.read('mcp-oauth:linear')).toBeUndefined()

    expect(readFileSync(join(target.directory, 'settings.json'), 'utf8')).toContain('"theme":"dark"')
    expect(readFileSync(join(target.directory, 'mcp.json'), 'utf8')).toContain('linear')
  })

  it('restores accounts sealed under the fresh sandbox key in the target home', async () => {
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

    await materializePortableState({ state, home: target.directory })
    const restored = await target.store.read(
      (await target.store.list()).find((held) => held.label === 'OpenRouter')!.id,
    )
    expect(restored?.secret).toEqual({ kind: EAuthKind.ApiKey, apiKey: 'sk-or-fake' })
  })

  it('writes every installed file owner-only', async () => {
    await seedSource({ source })
    const state = await capturePortableState({ home: source.directory })
    await materializePortableState({ state, home: target.directory })

    for (const name of ['key', 'auth.json', 'secrets.json', 'settings.json', 'mcp.json']) {
      expect(mode(join(target.directory, name))).toBe(0o600)
    }
  })

  it('never overwrites a live vault on resume, preserving a locally rotated key', async () => {
    await seedSource({ source })
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
    await seedSource({ source })
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

  it('respects an explicit file permission repair: chmod stays owner-only after install', async () => {
    await seedSource({ source })
    const state = await capturePortableState({ home: source.directory })
    writeFileSync(join(target.directory, 'settings.json'), '{"theme":"light"}\n')
    chmodSync(join(target.directory, 'settings.json'), 0o644)

    const install = await materializePortableState({ state, home: target.directory })

    expect(install.skipped).toContain(join(target.directory, 'settings.json'))
    expect(readFileSync(join(target.directory, 'settings.json'), 'utf8')).toContain('"theme":"light"')
  })

  it('installs accounts into a key-only home by resealing under the existing key', async () => {
    await seedSource({ source })
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
        'Claude subscription',
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
    await seedSource({ source })
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
    await seedSource({ source })
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
})
