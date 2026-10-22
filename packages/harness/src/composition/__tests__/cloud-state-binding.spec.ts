import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  ESettingId,
  toAccountId,
} from '@dltech/atlas-core'

import { CloudSessionStore } from '../../cloud/cloud-session'
import { encodeSettingValue } from '../../cloud/sync-settings'
import { atlasCloudFile, atlasVaultKeyFile } from '../../credentials/paths'
import { atlasSecretsFile } from '../../secrets/paths'
import { userSettingsFile } from '../../settings/paths'
import { composeHarness } from '../compose'
import type { HarnessApp } from '../harness-app'
import { loadSettings } from '../settings-binding'
import { recordingNotices, testPortBindings } from './fakes'

type Call = { method: string; path: string; body: unknown }

let project: string
let atlasHome: string
let previousAtlasHome: string | undefined
let server: ReturnType<typeof Bun.serve>
let calls: Call[]
let cloudSettings: Map<string, string>
let cloudAccounts: (typeof ACCOUNT)[]
const opened: HarnessApp<undefined, never>[] = []

const ACCOUNT = {
  id: 'acc_cloud',
  provider: EAuthProvider.OpenRouter,
  kind: EAuthKind.ApiKey,
  origin: EAccountOrigin.Login,
  label: 'cloud openrouter',
  status: EAccountStatus.Active,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const STAMP = '2026-01-01T00:00:00.000Z'

const handle = async (request: Request): Promise<Response> => {
  const path = new URL(request.url).pathname
  const text = await request.text()
  calls.push({ method: request.method, path, body: text === '' ? undefined : JSON.parse(text) })

  if (request.method === 'GET' && path === '/v1/accounts') return Response.json(cloudAccounts)
  if (request.method === 'GET' && path.startsWith('/v1/accounts/active/')) {
    return Response.json({ accountId: ACCOUNT.id })
  }
  if (request.method === 'GET' && path === '/v1/secrets') {
    return Response.json({
      secrets: [{ name: 'search.tavily', value: 'cloud-secret', updatedAt: STAMP }],
    })
  }
  if (request.method === 'GET' && path === '/v1/settings') {
    return Response.json({
      settings: [...cloudSettings].map(([key, value]) => ({ key, value, updatedAt: STAMP })),
    })
  }
  if (request.method === 'PUT' && path.startsWith('/v1/settings/')) {
    const body = calls.at(-1)?.body as { value: string }
    cloudSettings.set(decodeURIComponent(path.slice('/v1/settings/'.length)), body.value)
    return new Response(null, { status: 204 })
  }
  return Response.json({ message: 'unhandled' }, { status: 404 })
}

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'atlas-cloud-state-project-'))
  atlasHome = await mkdtemp(join(tmpdir(), 'atlas-cloud-state-home-'))
  previousAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = atlasHome
  calls = []
  cloudAccounts = [ACCOUNT]
  cloudSettings = new Map([[ESettingId.SmoothStreaming, encodeSettingValue(false)]])
  server = Bun.serve({ port: 0, fetch: handle })
})

afterEach(async () => {
  for (const app of opened.splice(0)) await app.close()
  server.stop(true)
  if (previousAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = previousAtlasHome
  await rm(project, { recursive: true, force: true })
  await rm(atlasHome, { recursive: true, force: true })
})

const signIn = (): void => {
  new CloudSessionStore({ file: atlasCloudFile(), keyFile: atlasVaultKeyFile() }).write({
    url: `http://localhost:${server.port}`,
    token: 'spec-session',
    email: null,
  })
}

const compose = async (cloudState: boolean | undefined) => {
  const notices = recordingNotices()
  const app = await composeHarness<undefined, never>({
    launch: { cwd: project, command: 'atlas-test', model: undefined, executionLocation: undefined },
    env: {},
    settings: loadSettings({ env: {}, cwd: project }),
    ports: testPortBindings(),
    clientVersion: 'cloud-state-spec',
    surface: { notice: notices.port },
    ...(cloudState === undefined ? {} : { cloudState }),
  })
  opened.push(app)
  return { app, notices }
}

const requestsTo = (resource: 'accounts' | 'secrets' | 'settings'): Call[] =>
  calls.filter((call) => call.path.startsWith(`/v1/${resource}`))

const eventually = async (check: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100 && !check(); attempt += 1) await Bun.sleep(10)
  expect(check()).toBe(true)
}

const localSettingsFile = (): Record<string, unknown> =>
  existsSync(userSettingsFile()) ? JSON.parse(readFileSync(userSettingsFile(), 'utf8')) : {}

describe('composeHarness with cloudState on', () => {
  it('lists accounts from the cloud and reads secrets from it', async () => {
    signIn()
    const { app } = await compose(true)

    expect((await app.accounts.list()).map((account) => account.id)).toEqual([
      toAccountId('acc_cloud'),
    ])
    expect(app.secrets.read('search.tavily')).toBe('cloud-secret')
    expect(requestsTo('accounts').length).toBeGreaterThan(0)
    expect(existsSync(atlasSecretsFile())).toBe(false)
  })

  it('keeps sandbox-serve and mcp-oauth secrets on this machine', async () => {
    signIn()
    const { app } = await compose(true)

    app.secrets.write({ name: 'sandbox-serve:thr_1', value: 'local-token' })
    app.secrets.write({ name: 'mcp-oauth:https://mcp.test/', value: '{}' })
    app.secrets.write({ name: 'search.exa', value: 'goes-to-cloud' })

    await eventually(() => requestsTo('secrets').some((call) => call.method === 'PUT'))
    const puts = requestsTo('secrets')
      .filter((call) => call.method === 'PUT')
      .map((call) => call.path)
    expect(puts).toEqual(['/v1/secrets/search.exa'])
    expect(app.secrets.read('sandbox-serve:thr_1')).toBe('local-token')
    expect(existsSync(atlasSecretsFile())).toBe(true)
  })

  it('reads cloud settings and writes a General key to the cloud, an Appearance key to the file', async () => {
    signIn()
    const { app } = await compose(true)

    expect(app.settings.snapshot().resolution.settings.get(ESettingId.SmoothStreaming)?.value).toBe(
      false,
    )

    expect(app.settings.set({ id: ESettingId.ThinkingBlocks, value: 'hidden' })).toEqual({
      ok: true,
    })
    expect(app.settings.set({ id: ESettingId.Accent, value: 'moss' })).toEqual({ ok: true })

    await eventually(() => requestsTo('settings').some((call) => call.method === 'PUT'))
    const puts = requestsTo('settings').filter((call) => call.method === 'PUT')
    expect(puts.map((call) => call.path)).toEqual([`/v1/settings/${ESettingId.ThinkingBlocks}`])
    expect(puts[0]?.body).toEqual({ value: encodeSettingValue('hidden') })

    expect(localSettingsFile()[ESettingId.Accent]).toBe('moss')
    expect(localSettingsFile()[ESettingId.ThinkingBlocks]).toBeUndefined()
    expect(app.settings.snapshot().resolution.settings.get(ESettingId.ThinkingBlocks)?.value).toBe(
      'hidden',
    )
  })

  it('does not post the legacy local-accounts notice even when the cloud holds no accounts', async () => {
    cloudAccounts = []
    signIn()
    const { notices } = await compose(true)

    expect(requestsTo('accounts').length).toBeGreaterThan(0)
    expect(notices.posts.some((post) => post.key === 'cloud:legacy-accounts')).toBe(false)
  })

  it('stays local and quiet while signed out', async () => {
    const { app } = await compose(true)

    expect(await app.accounts.list()).toEqual([])
    app.secrets.write({ name: 'search.exa', value: 'local-only' })
    expect(app.settings.set({ id: ESettingId.ThinkingBlocks, value: 'hidden' })).toEqual({
      ok: true,
    })

    expect(calls).toEqual([])
    expect(localSettingsFile()[ESettingId.ThinkingBlocks]).toBe('hidden')
  })
})

describe.each([false, undefined])('composeHarness with cloudState %p', (cloudState) => {
  it('uses local files and makes no request to accounts, secrets or settings', async () => {
    signIn()
    const { app, notices } = await compose(cloudState)

    expect(await app.accounts.list()).toEqual([])
    expect(app.secrets.read('search.tavily')).toBeUndefined()
    app.secrets.write({ name: 'search.exa', value: 'local-only' })
    expect(app.settings.set({ id: ESettingId.ThinkingBlocks, value: 'hidden' })).toEqual({
      ok: true,
    })
    await Bun.sleep(50)

    expect(calls.filter((call) => /^\/v1\/(accounts|secrets|settings)/.test(call.path))).toEqual([])
    expect(localSettingsFile()[ESettingId.ThinkingBlocks]).toBe('hidden')
    expect(existsSync(atlasSecretsFile())).toBe(true)
    expect(notices.posts.some((post) => post.key === 'cloud:legacy-accounts')).toBe(true)
  })
})
