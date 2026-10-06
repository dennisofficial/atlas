import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  AccountStorePort,
  CredentialPort,
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  type ClockPort,
} from '@dltech/atlas-core'

import { CloudSessionStore } from '../../cloud/cloud-session'
import { FileSecretsStore } from '../../secrets/file-secrets-store'
import { createHarnessContainer } from '../../container/create-harness-container'
import { disposeAll } from '../../container/disposal'
import { portToken } from '../../container/injection'
import { SecretsStoreToken } from '../../container/tokens'
import { atlasVaultFile, atlasVaultKeyFile } from '../../credentials/paths'
import { fileAccountStore } from '../../credentials/account-store'
import { CloudManagedCredentialPort } from '../../credentials/cloud-managed-credential-port'
import { bindAccounts } from '../account-bindings'
import { recordingNotices } from './fakes'

let atlasHome: string
let previousAtlasHome: string | undefined
let realFetch: typeof fetch

const fixedClock: ClockPort = { now: () => new Date().toISOString() }

const minutesAheadOfNow = (minutes: number): string =>
  new Date(Date.now() + minutes * 60_000).toISOString()

beforeEach(async () => {
  atlasHome = await mkdtemp(join(tmpdir(), 'atlas-account-bindings-'))
  previousAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = atlasHome
  realFetch = globalThis.fetch
})

afterEach(async () => {
  globalThis.fetch = realFetch
  if (previousAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = previousAtlasHome
  await rm(atlasHome, { recursive: true, force: true })
})

const cloudFetcher = () => {
  const fetches: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    fetches.push(String(input))
    throw new Error('cloud fetch must never fire')
  }) as unknown as typeof fetch
  return fetches
}

const signedInSession = (): void => {
  new CloudSessionStore({
    file: join(atlasHome, 'cloud.json'),
    keyFile: join(atlasHome, 'key'),
  }).write({ url: 'http://cloud.test', token: 'sess_x', email: 'a@b.c' })
}

const addLocalAccount = async (args: { expiresAt: string }) => {
  const store = fileAccountStore({
    file: atlasVaultFile(),
    keyFile: atlasVaultKeyFile(),
    clock: fixedClock,
  })
  return store.add({
    provider: EAuthProvider.Anthropic,
    label: 'work',
    origin: EAccountOrigin.Login,
    secret: {
      kind: EAuthKind.Oauth,
      tokens: {
        accessToken: 'fake-access-1',
        refreshToken: 'fake-refresh-1',
        expiresAt: args.expiresAt,
      },
    },
  })
}

describe('bindAccounts', () => {
  it('boots an empty store without reading any other tool, and keeps the environment API key', async () => {
    const container = createHarnessContainer()

    await bindAccounts({
      container,
      env: { ANTHROPIC_API_KEY: 'sk-ant-env-key' },
      cloudUrl: undefined,
      clientVersion: 'account-bindings-spec',
    })

    const listed = await container.resolve(portToken(AccountStorePort)).list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.origin).toBe(EAccountOrigin.Environment)
    expect(listed[0]?.importedFrom).toBe('environment:ANTHROPIC_API_KEY')

    await disposeAll({ container })
  })

  it('imports nothing when the environment holds no key', async () => {
    const container = createHarnessContainer()

    await bindAccounts({
      container,
      env: {},
      cloudUrl: undefined,
      clientVersion: 'account-bindings-spec',
    })

    expect(await container.resolve(portToken(AccountStorePort)).list()).toEqual([])

    await disposeAll({ container })
  })

  it('leaves a transferred vault untouched in a serve session — no environment reconciliation', async () => {
    const container = createHarnessContainer()
    const account = await addLocalAccount({ expiresAt: minutesAheadOfNow(60) })

    await bindAccounts({
      container,
      env: { ANTHROPIC_API_KEY: 'sk-ant-transferred-key' },
      cloudUrl: undefined,
      clientVersion: 'account-bindings-spec',
      reconcileHostSources: false,
    })

    const listed = await container.resolve(portToken(AccountStorePort)).list()
    expect(listed.map((held) => held.id)).toEqual([account.id])
    expect(listed.every((held) => held.origin === EAccountOrigin.Login)).toBe(true)

    await disposeAll({ container })
  })

  describe('while signed in to Atlas Cloud', () => {
    it('lists the local accounts without touching the cloud', async () => {
      const fetches = cloudFetcher()
      signedInSession()
      const container = createHarnessContainer()
      const account = await addLocalAccount({ expiresAt: minutesAheadOfNow(60) })

      await bindAccounts({
        container,
        env: {},
        cloudUrl: undefined,
        clientVersion: 'account-bindings-spec',
      })

      const listed = await container.resolve(portToken(AccountStorePort)).list()
      expect(listed.map((held) => held.id)).toEqual([account.id])
      expect(fetches).toEqual([])

      await disposeAll({ container })
    })

    it('hands off the native grant and keeps only access credentials locally', async () => {
      const fetches: string[] = []
      globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
        fetches.push(String(input))
        return Response.json({ accessToken: 'fake-cloud-access', expiresAt: minutesAheadOfNow(60), generation: 0 })
      }, { preconnect: () => undefined })
      signedInSession()
      const container = createHarnessContainer()
      const account = await addLocalAccount({ expiresAt: minutesAheadOfNow(30) })

      const { credentials } = await bindAccounts({
        container,
        env: {},
        cloudUrl: undefined,
        clientVersion: 'account-bindings-spec',
      })

      if (!(credentials instanceof CloudManagedCredentialPort)) throw new Error('cloud credential binding missing')
      await credentials.handoffAll({ url: 'http://cloud.test', token: 'sess_x', email: 'a@b.c' })
      const credential = await credentials.read({
        provider: EAuthProvider.Anthropic,
        accountId: account.id,
      })
      expect(credential).toMatchObject({ kind: EAuthKind.Oauth, accessToken: 'fake-cloud-access' })
      expect(fetches).toHaveLength(1)
      expect(fetches[0]).toContain('/v1/oauth-connections/oauth_')
      const stored = await container.resolve(portToken(AccountStorePort)).read(account.id)
      if (stored?.secret.kind !== EAuthKind.Oauth) throw new Error('OAuth account missing')
      expect(stored.secret.tokens.refreshToken).toBe('')
      expect(stored.secret.authority?.url).toBe('http://cloud.test')

      await disposeAll({ container })
    })

    it('gets renewable access from the cloud without calling the provider locally', async () => {
      const fetches: string[] = []
      globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
        const url = String(input)
        fetches.push(url)
        expect(url.startsWith('http://cloud.test/v1/oauth-connections/')).toBe(true)
        return Response.json({ accessToken: 'fake-cloud-access-2', expiresAt: minutesAheadOfNow(120), generation: 1 })
      }, { preconnect: () => undefined })
      signedInSession()
      const container = createHarnessContainer()
      await addLocalAccount({ expiresAt: new Date(Date.now() - 60_000).toISOString() })

      const { credentials } = await bindAccounts({
        container,
        env: {},
        cloudUrl: undefined,
        clientVersion: 'account-bindings-spec',
      })

      const credential = await credentials.read()
      expect(credential).toMatchObject({ accessToken: 'fake-cloud-access-2' })
      expect(fetches).toHaveLength(1)

      await disposeAll({ container })
    })

    it('reads and writes secrets through the local file, with no cloud request', async () => {
      const fetches = cloudFetcher()
      signedInSession()
      const container = createHarnessContainer()

      await bindAccounts({
        container,
        env: {},
        cloudUrl: undefined,
        clientVersion: 'account-bindings-spec',
      })

      const secrets = container.resolve(SecretsStoreToken)
      expect(secrets).toBeInstanceOf(FileSecretsStore)
      const fileSecrets = secrets as FileSecretsStore
      expect(fileSecrets.read('search.tavily')).toBeUndefined()
      fileSecrets.write({ name: 'search.tavily', value: 'tvly-fake' })
      expect(fileSecrets.read('search.tavily')).toBe('tvly-fake')
      expect(fileSecrets.names()).toEqual(['search.tavily'])
      fileSecrets.remove('search.tavily')
      expect(fileSecrets.read('search.tavily')).toBeUndefined()
      expect(fetches).toEqual([])

      await disposeAll({ container })
    })

    it('restores a vault the legacy sign-in archived before the stores resolve', async () => {
      const archivedVault = join(atlasHome, 'archived-vault.json')
      const archivedKey = join(atlasHome, 'archived-key')
      const store = fileAccountStore({
        file: archivedVault,
        keyFile: archivedKey,
        clock: fixedClock,
      })
      const account = await store.add({
        provider: EAuthProvider.Anthropic,
        label: 'work',
        origin: EAccountOrigin.Login,
        secret: {
          kind: EAuthKind.Oauth,
          tokens: {
            accessToken: 'fake-access-1',
            refreshToken: 'fake-refresh-1',
            expiresAt: minutesAheadOfNow(60),
          },
        },
      })
      await writeFile(`${atlasVaultFile()}.archived`, await readFile(archivedVault))
      await writeFile(`${atlasVaultKeyFile()}.archived`, await readFile(archivedKey))

      const fetches = cloudFetcher()
      signedInSession()
      const container = createHarnessContainer()

      await bindAccounts({
        container,
        env: {},
        cloudUrl: undefined,
        clientVersion: 'account-bindings-spec',
      })

      const listed = await container.resolve(portToken(AccountStorePort)).list()
      expect(listed.map((held) => held.id)).toEqual([account.id])
      expect(fetches).toEqual([])

      await disposeAll({ container })
    })
  })
})
