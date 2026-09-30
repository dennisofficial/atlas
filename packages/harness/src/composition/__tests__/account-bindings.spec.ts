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
  type OauthTokens,
} from '@dltech/atlas-core'

import { CloudSessionStore } from '../../cloud/cloud-session'
import { FileSecretsStore } from '../../secrets/file-secrets-store'
import { createHarnessContainer } from '../../container/create-harness-container'
import { disposeAll } from '../../container/disposal'
import { portToken } from '../../container/injection'
import {
  ClaudeCodeSourceToken,
  CodexSourceToken,
  SecretsStoreToken,
} from '../../container/tokens'
import { ClaudeCodeSource } from '../../credentials/claude-code-source'
import { CodexSource } from '../../credentials/codex-source'
import { fakeCodexAuthPayload, fakeJwt } from '../../credentials/__tests__/fixtures'
import { atlasVaultFile, atlasVaultKeyFile } from '../../credentials/paths'
import { fileAccountStore } from '../../credentials/account-store'
import { RefreshingCredentialPort } from '../../credentials/refreshing-credential-port'
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

const silentSources = (container: ReturnType<typeof createHarnessContainer>): void => {
  container.register(ClaudeCodeSourceToken, {
    useValue: new ClaudeCodeSource({ read: async () => undefined, write: async () => {} }),
  })
  container.register(CodexSourceToken, {
    useValue: new CodexSource({ file: join(atlasHome, 'no-codex-auth.json') }),
  })
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

const scriptedRefresh = (rotated: OauthTokens) => {
  const seen: string[] = []
  return {
    seen,
    refresh: async (args: { refreshToken: string }): Promise<OauthTokens> => {
      seen.push(args.refreshToken)
      return rotated
    },
  }
}

describe('bindAccounts', () => {
  it('adopts an existing Codex login into the vault at composition time', async () => {
    const container = createHarnessContainer()
    const codexFile = join(atlasHome, 'codex-auth.json')
    await writeFile(
      codexFile,
      fakeCodexAuthPayload({ idToken: fakeJwt({ email: 'dennis@example.com' }) }),
      { mode: 0o600 },
    )
    container.register(CodexSourceToken, { useValue: new CodexSource({ file: codexFile }) })
    container.register(ClaudeCodeSourceToken, {
      useValue: new ClaudeCodeSource({ read: async () => undefined, write: async () => {} }),
    })

    await bindAccounts({
      container,
      env: {},
      cloudUrl: undefined,
      clientVersion: 'account-bindings-spec',
    })

    const accounts = await container.resolve(portToken(AccountStorePort)).list()
    const imported = accounts.find((account) => account.provider === EAuthProvider.OpenAI)
    expect(imported?.origin).toBe(EAccountOrigin.Imported)
    expect(imported?.importedFrom).toBe('codex')
    expect(imported?.email).toBe('dennis@example.com')

    await disposeAll({ container })
  })

  it('leaves a transferred vault untouched in a serve session — no env or host-source reconciliation', async () => {
    const container = createHarnessContainer()
    container.register(ClaudeCodeSourceToken, {
      useValue: new ClaudeCodeSource({
        read: async () => {
          throw new Error('host source must not be read in serve')
        },
        write: async () => {},
      }),
    })
    container.register(CodexSourceToken, {
      useValue: new CodexSource({ file: join(atlasHome, 'no-codex-auth.json') }),
    })
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

  it('rethrows a local import failure that is not an absent source', async () => {
    const container = createHarnessContainer()
    container.register(ClaudeCodeSourceToken, {
      useValue: new ClaudeCodeSource({
        read: async () => {
          throw new Error('the vault caught fire')
        },
        write: async () => {},
      }),
    })
    container.register(CodexSourceToken, {
      useValue: new CodexSource({ file: join(atlasHome, 'no-codex-auth.json') }),
    })

    await expect(
      bindAccounts({
        container,
        env: {},
        cloudUrl: undefined,
        clientVersion: 'account-bindings-spec',
      }),
    ).rejects.toThrow('the vault caught fire')
  })

  describe('while signed in to Atlas Cloud', () => {
    it('lists the local accounts without touching the cloud', async () => {
      const fetches = cloudFetcher()
      signedInSession()
      const container = createHarnessContainer()
      silentSources(container)
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

    it('hands back a fresh local credential without a cloud request', async () => {
      const fetches = cloudFetcher()
      signedInSession()
      const container = createHarnessContainer()
      silentSources(container)
      const account = await addLocalAccount({ expiresAt: minutesAheadOfNow(30) })

      const { credentials } = await bindAccounts({
        container,
        env: {},
        cloudUrl: undefined,
        clientVersion: 'account-bindings-spec',
      })

      const credential = await credentials.read({
        provider: EAuthProvider.Anthropic,
        accountId: account.id,
      })
      expect(credential).toMatchObject({ kind: EAuthKind.Oauth, accessToken: 'fake-access-1' })
      expect(fetches).toEqual([])

      await disposeAll({ container })
    })

    it('refreshes an expiring token through the provider, not the cloud', async () => {
      const fetches = cloudFetcher()
      signedInSession()
      const container = createHarnessContainer()
      silentSources(container)
      await addLocalAccount({ expiresAt: new Date(Date.now() - 60_000).toISOString() })
      const client = scriptedRefresh({
        accessToken: 'fake-access-2',
        refreshToken: 'fake-refresh-2',
        expiresAt: minutesAheadOfNow(120),
      })
      container.register(portToken(CredentialPort), {
        useFactory: (resolver) =>
          new RefreshingCredentialPort({
            accounts: resolver.resolve(portToken(AccountStorePort)),
            clients: { [EAuthProvider.Anthropic]: client },
            clock: fixedClock,
          }),
      })

      const { credentials } = await bindAccounts({
        container,
        env: {},
        cloudUrl: undefined,
        clientVersion: 'account-bindings-spec',
      })

      const credential = await credentials.read()
      expect(credential).toMatchObject({ accessToken: 'fake-access-2' })
      expect(client.seen).toEqual(['fake-refresh-1'])
      expect(fetches).toEqual([])

      await disposeAll({ container })
    })

    it('reads and writes secrets through the local file, with no cloud request', async () => {
      const fetches = cloudFetcher()
      signedInSession()
      const container = createHarnessContainer()
      silentSources(container)

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
      silentSources(container)

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
