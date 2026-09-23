import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { AccountStorePort, EAccountOrigin, EAuthProvider, ENoticeTone } from '@dltech/atlas-core'

import { CloudError } from '../../cloud/cloud-transport'
import { createHarnessContainer } from '../../container/create-harness-container'
import { disposeAll } from '../../container/disposal'
import { portToken } from '../../container/injection'
import {
  ClaudeCodeSourceToken,
  CloudSessionStoreToken,
  CodexSourceToken,
  SecretsStoreToken,
} from '../../container/tokens'
import { ClaudeCodeSource } from '../../credentials/claude-code-source'
import { CodexSource } from '../../credentials/codex-source'
import { fakeCodexAuthPayload, fakeJwt } from '../../credentials/__tests__/fixtures'
import { bindAccounts } from '../account-bindings'
import { recordingNotices, type RecordedNotices } from './fakes'

let atlasHome: string
let previousAtlasHome: string | undefined

beforeEach(async () => {
  atlasHome = await mkdtemp(join(tmpdir(), 'atlas-account-bindings-'))
  previousAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = atlasHome
})

afterEach(async () => {
  if (previousAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = previousAtlasHome
  await rm(atlasHome, { recursive: true, force: true })
})

const failingClaudeCodeSource = (): ClaudeCodeSource =>
  new ClaudeCodeSource({
    read: async () => {
      throw new CloudError({ status: 0, message: 'Atlas Cloud is unreachable' })
    },
    write: async () => {},
  })

const absentCodexSource = (): CodexSource =>
  new CodexSource({ file: join(atlasHome, 'no-codex-auth.json') })



describe('bindAccounts', () => {
  it('reports a cloud outage through the notice port instead of failing composition', async () => {
    const container = createHarnessContainer()
    container.register(ClaudeCodeSourceToken, { useValue: failingClaudeCodeSource() })
    container.register(CodexSourceToken, { useValue: absentCodexSource() })
    const recorded: RecordedNotices = recordingNotices()

    await bindAccounts({
      container,
      env: {},
      notice: recorded.port,
      cloudUrl: undefined,
      clientVersion: 'account-bindings-spec',
    })

    const posted = recorded.posts.find((post) => post.key === 'cloud:accounts')
    expect(posted?.tone).toBe(ENoticeTone.Warn)
    expect(posted?.text).toContain('Atlas Cloud accounts could not be reconciled')
  })

  it('rewarmSecrets stays local while signed out and re-fetches once a session exists', async () => {
    const container = createHarnessContainer()
    container.register(ClaudeCodeSourceToken, { useValue: failingClaudeCodeSource() })
    container.register(CodexSourceToken, { useValue: absentCodexSource() })

    const { rewarmSecrets } = await bindAccounts({
      container,
      env: {},
      notice: recordingNotices().port,
      cloudUrl: undefined,
      clientVersion: 'account-bindings-spec',
    })

    const secrets = container.resolve(SecretsStoreToken)
    const sessions = container.resolve(CloudSessionStoreToken)

    const realFetch = globalThis.fetch
    const fetches: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      fetches.push(String(input))
      return new Response(
        JSON.stringify({
          secrets: [
            { name: 'search.tavily', value: 'tvly-9', updatedAt: '2026-01-01T00:00:00.000Z' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    try {
      await rewarmSecrets()
      expect(fetches).toHaveLength(0)

      sessions.write({ url: 'http://cloud.test', token: 'sess_x', email: 'a@b.c' })
      expect(secrets.read('search.tavily')).toBeUndefined()

      await rewarmSecrets()

      expect(secrets.read('search.tavily')).toBe('tvly-9')
      expect(fetches).toEqual(['http://cloud.test/v1/secrets'])
    } finally {
      globalThis.fetch = realFetch
      await disposeAll({ container })
    }
  })

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
      notice: recordingNotices().port,
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

  it('rethrows a failure that is not a cloud outage', async () => {
    const container = createHarnessContainer()
    container.register(ClaudeCodeSourceToken, {
      useValue: new ClaudeCodeSource({
        read: async () => {
          throw new Error('the vault caught fire')
        },
        write: async () => {},
      }),
    })
    container.register(CodexSourceToken, { useValue: absentCodexSource() })

    await expect(
      bindAccounts({
        container,
        env: {},
        notice: recordingNotices().port,
        cloudUrl: undefined,
        clientVersion: 'account-bindings-spec',
      }),
    ).rejects.toThrow('the vault caught fire')
  })
})
