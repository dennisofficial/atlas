import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EAccountOrigin, EAuthKind, EAuthProvider } from '@dltech/atlas-core'

import {
  oauthAuthorityOf,
  startFakeAccountCloud,
  type FakeAccountCloud,
} from '../../cloud/__tests__/fake-account-cloud'
import { CloudSessionStore } from '../../cloud/cloud-session'
import type { CloudLoginTicket } from '../../cloud/device-login'
import { fileAccountStore } from '../../credentials/account-store'
import { atlasCloudFile, atlasVaultFile, atlasVaultKeyFile } from '../../credentials/paths'
import { SystemClock } from '../../store/clock'
import { composeHarness } from '../compose'
import type { HarnessApp } from '../harness-app'
import { loadSettings } from '../settings-binding'
import { recordingNotices, testPortBindings } from './fakes'

const ANTHROPIC_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'

let project: string
let atlasHome: string
let previousAtlasHome: string | undefined
let cloud: FakeAccountCloud
const realFetch = globalThis.fetch
const opened: HarnessApp<undefined, never>[] = []

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'atlas-cloud-login-project-'))
  atlasHome = await mkdtemp(join(tmpdir(), 'atlas-cloud-login-home-'))
  previousAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = atlasHome
  cloud = startFakeAccountCloud()
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === ANTHROPIC_TOKEN_URL) {
      return Response.json({
        access_token: 'claude-access',
        refresh_token: 'claude-refresh',
        expires_in: 3600,
        account: { email_address: 'dennis@example.test' },
      })
    }
    return realFetch(input, init)
  }) as typeof fetch
})

afterEach(async () => {
  for (const app of opened.splice(0)) await app.close()
  globalThis.fetch = realFetch
  cloud.stop()
  if (previousAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = previousAtlasHome
  await rm(project, { recursive: true, force: true })
  await rm(atlasHome, { recursive: true, force: true })
})

const compose = async () => {
  const notices = recordingNotices()
  const app = await composeHarness<undefined, never>({
    launch: {
      cwd: project,
      command: 'atlas-test',
      model: undefined,
      executionLocation: undefined,
    },
    env: {},
    settings: loadSettings({ env: {}, cwd: project }),
    ports: testPortBindings(),
    clientVersion: 'cloud-backed-login-spec',
    surface: { notice: notices.port },
    cloudSettings: true,
    cloudSecretsAndAccounts: true,
  })
  opened.push(app)
  return { app, notices }
}

const ticket = (): CloudLoginTicket => ({
  url: cloud.url,
  deviceCode: 'fake-device',
  userCode: 'FAKE-CODE',
  verificationUrl: `${cloud.url}/device`,
  expiresInMs: 60_000,
  intervalMs: 1_000,
})

const signIn = (app: HarnessApp<undefined, never>) =>
  app.cloud.finishLogin({ ticket: ticket(), token: 'fake-session' })

const seedLocalClaude = () =>
  fileAccountStore({
    file: atlasVaultFile(),
    keyFile: atlasVaultKeyFile(),
    clock: new SystemClock(),
  }).add({
    provider: EAuthProvider.Anthropic,
    label: 'dennis@example.test',
    email: 'dennis@example.test',
    origin: EAccountOrigin.Login,
    secret: {
      kind: EAuthKind.Oauth,
      tokens: {
        accessToken: 'local-access',
        refreshToken: 'local-refresh',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    },
  })

const localVaultAccounts = (file: string): unknown[] =>
  existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as { accounts: unknown[] }).accounts
    : []

const eventually = async (check: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) await Bun.sleep(10)
  expect(check()).toBe(true)
}

describe('a TUI signed in to Atlas Cloud owns no accounts locally', () => {
  it('fresh install → cloud sign-in → Claude login lands an active, cloud-owned AgentAccount', async () => {
    const { app } = await compose()
    await signIn(app)

    const login = app.accounts.begin(EAuthProvider.Anthropic)
    const account = await app.accounts.complete({
      ticket: login,
      pasted: `fake-code#${login.pkce.state}`,
    })

    expect(cloud.accounts.map((held) => held['id'])).toEqual([account.id])
    expect(cloud.actives.get(EAuthProvider.Anthropic)).toBe(account.id)
    await eventually(() => cloud.uploads.length === 1)
    await eventually(() => oauthAuthorityOf(cloud.accounts[0])?.['authorizationId'] !== undefined)
    expect(oauthAuthorityOf(cloud.accounts[0])?.['url']).toBe(cloud.url)
    expect(localVaultAccounts(atlasVaultFile())).toEqual([])
  })

  it('migrates existing local accounts on sign-in and hands each off exactly once', async () => {
    await seedLocalClaude()
    const { app } = await compose()

    await signIn(app)

    expect(cloud.accounts).toHaveLength(1)
    expect(cloud.actives.get(EAuthProvider.Anthropic)).toBe(String(cloud.accounts[0]?.['id']))
    expect(cloud.uploads).toHaveLength(1)
    expect(oauthAuthorityOf(cloud.accounts[0])?.['url']).toBe(cloud.url)
    expect(localVaultAccounts(atlasVaultFile())).toEqual([])
    expect(localVaultAccounts(`${atlasVaultFile()}.archived`)).toHaveLength(1)
    expect((await app.accounts.list()).map((held) => String(held.id))).toEqual([
      String(cloud.accounts[0]?.['id']),
    ])
  })

  it('signing out restores the local vault, and signing back in duplicates nothing', async () => {
    await seedLocalClaude()
    const { app } = await compose()
    await signIn(app)

    app.cloud.logout()
    expect(localVaultAccounts(atlasVaultFile())).toHaveLength(1)
    expect(existsSync(`${atlasVaultFile()}.archived`)).toBe(false)

    await signIn(app)

    expect(cloud.accounts).toHaveLength(1)
    expect(cloud.uploads).toHaveLength(1)
    expect(localVaultAccounts(atlasVaultFile())).toEqual([])
  })

  it('surfaces a failed migration and keeps the local accounts', async () => {
    await seedLocalClaude()
    cloud.failOn.add('accounts.create')
    const { app } = await compose()

    await expect(signIn(app)).rejects.toThrow(/moving this machine's accounts/)

    expect(app.cloud.session()).not.toBeNull()
    expect(cloud.accounts).toEqual([])
    expect(localVaultAccounts(atlasVaultFile())).toHaveLength(1)
  })

  it('migrates at startup for a machine that signed in before accounts were cloud-backed', async () => {
    await seedLocalClaude()
    new CloudSessionStore({
      file: atlasCloudFile(),
      keyFile: atlasVaultKeyFile(),
    }).write({
      url: cloud.url,
      token: 'fake-session',
      email: null,
    })

    const { app } = await compose()

    expect(cloud.accounts).toHaveLength(1)
    expect(localVaultAccounts(atlasVaultFile())).toEqual([])
    expect((await app.accounts.list()).map((held) => held.provider)).toEqual([
      EAuthProvider.Anthropic,
    ])
  })
})
