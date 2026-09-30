import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  type AccountSecret,
  type ClockPort,
} from '@dltech/atlas-core'

import { memoryAccountStore, type AccountStore } from '../../credentials/account-store'
import { SecretCipher } from '../../credentials/secret-cipher'
import { FileSecretsStore } from '../../secrets/file-secrets-store'
import { MemorySettingsStore } from '../../settings/memory-store'
import { CloudError } from '../cloud-client'
import { CloudService } from '../cloud-service'
import { CloudSessionStore } from '../cloud-session'

const clock: ClockPort = { now: () => '2026-01-01T00:00:00.000Z' }

const URL = 'http://cloud.test'

const secretFor = (provider: string): AccountSecret => ({
  kind: EAuthKind.ApiKey,
  apiKey: `sk-${provider}`,
})

const deviceCodeBody = {
  device_code: 'dev_code_1',
  user_code: 'ABCD-EFGH',
  verification_uri: `${URL}/device`,
  verification_uri_complete: `${URL}/device?user_code=ABCD-EFGH`,
  expires_in: 300,
  interval: 5,
}

type CloudFake = {
  fetchFn: typeof fetch
  added: Record<string, unknown>[]
  actives: { provider: string; accountId: string }[]
  remoteAccounts: Record<string, unknown>[]
  remoteSecrets: { name: string; value: string; updatedAt: string }[]
  putSecrets: { name: string; value: unknown }[]
  remoteMcp: Record<string, unknown>[]
  putMcp: { name: string; body: Record<string, unknown> }[]
  remoteSettings: { key: string; value: string; updatedAt: string }[]
  putSettings: { key: string; value: unknown }[]
  clientVersions: { path: string; version: string | null }[]
  failAccountsList: boolean
  failOn: string[]
}

const cloudFake = (): CloudFake => {
  const fake: CloudFake = {
    added: [],
    actives: [],
    remoteAccounts: [],
    remoteSecrets: [],
    putSecrets: [],
    remoteMcp: [],
    putMcp: [],
    remoteSettings: [],
    putSettings: [],
    clientVersions: [],
    failAccountsList: false,
    failOn: [],
    fetchFn: undefined as unknown as typeof fetch,
  }

  fake.fetchFn = (async (input: unknown, init?: RequestInit) => {
    const path = String(input).slice(URL.length)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    fake.clientVersions.push({
      path,
      version: new Headers(init?.headers).get('atlas-client-version'),
    })

    if (fake.failOn.some((fragment) => `${method} ${path}`.includes(fragment))) {
      return new Response(JSON.stringify({ message: 'the cloud hiccuped' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    }

    const reply = (status: number, payload?: unknown) =>
      new Response(payload === undefined ? null : JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      })

    if (path === '/v1/health') return reply(200, { status: 'ok' })
    if (path === '/api/auth/device/code') return reply(200, deviceCodeBody)
    if (path === '/api/auth/get-session')
      return reply(200, { user: { email: 'dev@example.com', name: 'Dev' }, session: {} })
    if (path === '/v1/accounts' && method === 'GET') {
      if (fake.failAccountsList) return reply(500, { message: 'listing broke' })
      return reply(200, fake.remoteAccounts)
    }
    if (path === '/v1/accounts' && method === 'POST') {
      const id = `acc_remote_${fake.added.length + 1}`
      fake.added.push(body ?? {})
      const secret = body?.['secret'] as AccountSecret
      return reply(201, {
        id,
        provider: body?.['provider'],
        kind: secret.kind,
        origin: body?.['origin'],
        label: body?.['label'],
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    }
    if (path === '/v1/accounts/active' && method === 'PUT') {
      fake.actives.push({
        provider: String(body?.['provider']),
        accountId: String(body?.['accountId']),
      })
      return reply(204)
    }
    if (path.startsWith('/v1/accounts/active/') && method === 'GET') {
      const provider = path.slice('/v1/accounts/active/'.length)
      const held = fake.actives.find((active) => active.provider === provider)
      return reply(200, { accountId: held?.accountId ?? null })
    }
    if (path.startsWith('/v1/accounts/') && method === 'GET') {
      const id = path.slice('/v1/accounts/'.length)
      const held = fake.remoteAccounts.find((account) => account['id'] === id)
      if (held === undefined) return reply(404, { message: 'no such account' })
      return reply(200, held)
    }
    if (path === '/v1/secrets' && method === 'GET') return reply(200, { secrets: fake.remoteSecrets })
    if (path.startsWith('/v1/secrets/') && method === 'PUT') {
      const name = path.slice('/v1/secrets/'.length)
      fake.putSecrets.push({ name, value: body?.['value'] })
      fake.remoteSecrets.push({ name, value: String(body?.['value']), updatedAt: '2026-01-01T00:00:00.000Z' })
      return reply(204)
    }
    if (path === '/v1/settings' && method === 'GET') return reply(200, { settings: fake.remoteSettings })
    if (path.startsWith('/v1/settings/') && method === 'PUT') {
      const key = path.slice('/v1/settings/'.length)
      fake.putSettings.push({ key, value: body?.['value'] })
      const held = fake.remoteSettings.find((setting) => setting.key === key)
      if (held === undefined) {
        fake.remoteSettings.push({ key, value: String(body?.['value']), updatedAt: '2026-01-01T00:00:00.000Z' })
      } else {
        held.value = String(body?.['value'])
      }
      return reply(204)
    }
    if (path.startsWith('/v1/settings/') && method === 'DELETE') {
      const key = path.slice('/v1/settings/'.length)
      fake.remoteSettings = fake.remoteSettings.filter((setting) => setting.key !== key)
      return reply(204)
    }
    if (path === '/v1/mcp-servers' && method === 'GET') return reply(200, { servers: fake.remoteMcp })
    if (path.startsWith('/v1/mcp-servers/') && method === 'PUT') {
      const name = path.slice('/v1/mcp-servers/'.length)
      fake.putMcp.push({ name, body: body ?? {} })
      fake.remoteMcp.push({ name, ...(body ?? {}), updatedAt: '2026-01-01T00:00:00.000Z' })
      return reply(204)
    }

    return reply(404, { message: `unhandled ${method} ${path}` })
  }) as typeof fetch

  return fake
}

let directory: string
let sessions: CloudSessionStore
let local: AccountStore
let localSecrets: FileSecretsStore
let localSettings: MemorySettingsStore

const realAtlasHome = process.env['ATLAS_HOME']

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-cloud-service-'))
  process.env['ATLAS_HOME'] = directory
  sessions = new CloudSessionStore({
    file: join(directory, 'cloud.json'),
    keyFile: join(directory, 'key'),
  })
  local = memoryAccountStore({ clock })
  localSecrets = new FileSecretsStore({
    file: join(directory, 'secrets.json'),
    cipher: new SecretCipher(join(directory, 'key')),
  })
  localSettings = new MemorySettingsStore()
})

afterEach(() => {
  if (realAtlasHome === undefined) delete process.env['ATLAS_HOME']
  else process.env['ATLAS_HOME'] = realAtlasHome
  rmSync(directory, { recursive: true, force: true })
})

const serviceOver = (fetchFn: typeof fetch) =>
  new CloudService({ sessions, localAccounts: local, defaultUrl: URL, fetchFn })

const serviceWithSecrets = (fetchFn: typeof fetch) =>
  new CloudService({ sessions, localAccounts: local, defaultUrl: URL, localSecrets, fetchFn })

const serviceWithSettings = (fetchFn: typeof fetch) =>
  new CloudService({
    sessions,
    localAccounts: local,
    defaultUrl: URL,
    localSecrets,
    localSettings,
    fetchFn,
  })

const seedLocal = async () => {
  const anthropic = await local.add({
    provider: EAuthProvider.Anthropic,
    label: 'work',
    secret: secretFor('anthropic'),
    origin: EAccountOrigin.Login,
    email: 'work@example.com',
  })
  const openai = await local.add({
    provider: EAuthProvider.OpenAI,
    label: 'personal',
    secret: secretFor('openai'),
    origin: EAccountOrigin.Imported,
    importedFrom: 'codex',
  })
  return { anthropic, openai }
}

describe('CloudService sign-in', () => {
  it('beginLogin throws a clear CloudError when the host is unreachable', async () => {
    const down = (() =>
      Promise.reject(new Error('connection refused'))) as unknown as typeof fetch
    const service = serviceOver(down)

    const failure = await service.beginLogin().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).message).toContain('is the cloud API running?')
  })

  it('beginLogin health-checks and then starts the device login', async () => {
    const fake = cloudFake()
    const service = serviceOver(fake.fetchFn)

    const ticket = await service.beginLogin()

    expect(ticket.url).toBe(URL)
    expect(ticket.userCode).toBe('ABCD-EFGH')
    expect(ticket.verificationUrl).toBe(`${URL}/device?user_code=ABCD-EFGH`)
  })

  it('finishLogin records only the session identity, importing and archiving nothing', async () => {
    const fake = cloudFake()
    const service = serviceWithSettings(fake.fetchFn)
    await seedLocal()
    localSecrets.write({ name: 'search.tavily', value: 'tvly-1' })
    writeFileSync(join(directory, 'auth.json'), '{"version":1,"accounts":[]}')
    writeFileSync(
      join(directory, 'mcp.json'),
      JSON.stringify({ linear: { transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' } } }),
    )
    localSettings.write({ values: { 'appearance.accent': 'moss' } })

    const ticket = await service.beginLogin()
    const result = await service.finishLogin({ ticket, token: 'sess_new' })

    expect(result.session).toEqual({ url: URL, token: 'sess_new', email: 'dev@example.com' })
    expect(Object.keys(result)).toEqual(['session'])
    expect(service.session()).toEqual(result.session)

    expect(fake.added).toEqual([])
    expect(fake.actives).toEqual([])
    expect(fake.putSecrets).toEqual([])
    expect(fake.putMcp).toEqual([])
    expect(fake.putSettings).toEqual([])

    expect(existsSync(join(directory, 'auth.json'))).toBe(true)
    expect(existsSync(join(directory, 'auth.json.archived'))).toBe(false)
    expect(localSecrets.read('search.tavily')).toBe('tvly-1')
    expect(localSettings.read().document.values).toEqual({ 'appearance.accent': 'moss' })
  })

  it('finishLogin sends no sync requests beyond the session confirmation', async () => {
    const fake = cloudFake()
    const service = serviceWithSettings(fake.fetchFn)
    await seedLocal()

    const ticket = await service.beginLogin()
    fake.clientVersions.length = 0
    await service.finishLogin({ ticket, token: 'sess_new' })

    const syncPaths = fake.clientVersions.filter((call) => call.path.startsWith('/v1/'))
    expect(syncPaths).toEqual([])
  })

  it('logout clears the session and never touches the local files', async () => {
    const fake = cloudFake()
    const service = serviceWithSettings(fake.fetchFn)
    await seedLocal()
    writeFileSync(join(directory, 'auth.json'), '{"version":1,"accounts":[]}')
    localSecrets.write({ name: 'search.tavily', value: 'tvly-1' })

    const ticket = await service.beginLogin()
    await service.finishLogin({ ticket, token: 'sess_new' })
    expect(service.session()).not.toBeNull()

    service.logout()

    expect(service.session()).toBeNull()
    expect(existsSync(join(directory, 'auth.json'))).toBe(true)
    expect(localSecrets.read('search.tavily')).toBe('tvly-1')
    expect(existsSync(join(directory, 'auth.json.archived'))).toBe(false)
  })

  it('logout restores archived local files left by an older sign-in', async () => {
    const fake = cloudFake()
    const service = serviceOver(fake.fetchFn)
    writeFileSync(join(directory, 'auth.json.archived'), '{"version":1,"accounts":["old"]}')
    sessions.write({ url: URL, token: 'sess_a', email: null })

    service.logout()

    expect(existsSync(join(directory, 'auth.json'))).toBe(true)
    expect(existsSync(join(directory, 'auth.json.archived'))).toBe(false)
    expect(JSON.parse(readFileSync(join(directory, 'auth.json'), 'utf8'))).toEqual({
      version: 1,
      accounts: ['old'],
    })
  })

  it('client is null when signed out', () => {
    const service = serviceOver(cloudFake().fetchFn)

    expect(service.client()).toBeNull()
  })

  it('client caches one CloudClient per session token', () => {
    const service = serviceOver(cloudFake().fetchFn)
    sessions.write({ url: URL, token: 'sess_a', email: null })

    const first = service.client()

    expect(first).not.toBeNull()
    expect(service.client()).toBe(first)

    sessions.write({ url: URL, token: 'sess_b', email: null })

    const rebuilt = service.client()

    expect(rebuilt).not.toBe(first)
    expect(service.client()).toBe(rebuilt)
    expect(rebuilt?.baseUrl).toBe(URL)
  })

  it('sends the wired client version on every v1 request its clients make', async () => {
    const fake = cloudFake()
    const service = new CloudService({
      sessions,
      localAccounts: local,
      defaultUrl: URL,
      clientVersion: '1.2.3',
      fetchFn: fake.fetchFn,
    })

    const ticket = await service.beginLogin()
    await service.finishLogin({ ticket, token: 'sess_new' })
    await service.client()?.listAccounts()

    const v1Calls = fake.clientVersions.filter((call) => call.path.startsWith('/v1/'))
    expect(v1Calls.length).toBeGreaterThan(0)
    for (const call of v1Calls) {
      expect(call.version).toBe('1.2.3')
    }
  })
})

describe('CloudService explicit sync', () => {
  const signIn = () => sessions.write({ url: URL, token: 'sess_a', email: null })

  it('uploadLocalToCloud pushes local items even when the cloud already holds some', async () => {
    const fake = cloudFake()
    fake.remoteAccounts.push({
      id: 'acc_existing',
      provider: EAuthProvider.Anthropic,
      kind: EAuthKind.ApiKey,
      origin: EAccountOrigin.Login,
      label: 'existing',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      secret: secretFor('other'),
    })
    fake.remoteSecrets.push({ name: 'existing', value: 'v', updatedAt: '2026-01-01T00:00:00.000Z' })
    fake.remoteMcp.push({ name: 'existing', disabled: true, updatedAt: '2026-01-01T00:00:00.000Z' })
    const service = serviceWithSettings(fake.fetchFn)
    await seedLocal()
    localSecrets.write({ name: 'search.tavily', value: 'tvly-1' })
    writeFileSync(
      join(directory, 'mcp.json'),
      JSON.stringify({ linear: { transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' } } }),
    )
    localSettings.write({ values: { 'appearance.accent': 'moss' } })
    signIn()

    const counts = await service.uploadLocalToCloud()

    expect(counts).toEqual({ accounts: 2, secrets: 1, mcpServers: 1, settings: 1 })
    expect(fake.added).toHaveLength(2)
    expect(fake.putSecrets).toEqual([{ name: 'search.tavily', value: 'tvly-1' }])
    expect(fake.putMcp).toEqual([
      { name: 'linear', body: { transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' } } },
    ])
    expect(fake.putSettings).toEqual([
      { key: 'appearance.accent', value: 'atlas-setting:v1:"moss"' },
    ])
  })

  it('uploadLocalToCloud skips an account the cloud already holds verbatim', async () => {
    const fake = cloudFake()
    const service = serviceWithSettings(fake.fetchFn)
    const seeded = await seedLocal()
    const stored = await local.read(seeded.anthropic.id)
    fake.remoteAccounts.push({
      id: 'acc_same',
      provider: EAuthProvider.Anthropic,
      kind: EAuthKind.ApiKey,
      origin: EAccountOrigin.Login,
      label: 'work',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      secret: stored?.secret,
    })
    signIn()

    const counts = await service.uploadLocalToCloud()

    expect(counts.accounts).toBe(2)
    expect(fake.added).toHaveLength(1)
    expect(fake.added[0]?.['label']).toBe('personal')
  })

  it('downloadCloudToLocal lands remote items locally and deletes nothing remotely', async () => {
    const fake = cloudFake()
    fake.remoteAccounts.push({
      id: 'acc_remote',
      provider: EAuthProvider.Anthropic,
      kind: EAuthKind.ApiKey,
      origin: EAccountOrigin.Login,
      label: 'remote work',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      secret: secretFor('remote'),
    })
    fake.remoteSecrets.push({ name: 'search.tavily', value: 'tvly-9', updatedAt: '2026-01-01T00:00:00.000Z' })
    fake.remoteMcp.push({
      name: 'linear',
      transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' },
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    fake.remoteSettings.push({
      key: 'sandbox.image',
      value: 'img-9',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const service = serviceWithSettings(fake.fetchFn)
    signIn()

    const counts = await service.downloadCloudToLocal()

    expect(counts).toEqual({ accounts: 1, secrets: 1, mcpServers: 1, settings: 1 })
    expect((await local.list()).map((account) => account.label)).toEqual(['remote work'])
    expect(localSecrets.read('search.tavily')).toBe('tvly-9')
    expect(existsSync(join(directory, 'mcp.json'))).toBe(true)
    expect(localSettings.read().document.values['sandbox.image']).toBe('img-9')

    expect(fake.remoteAccounts).toHaveLength(1)
    expect(fake.remoteSecrets).toHaveLength(1)
    expect(fake.remoteMcp).toHaveLength(1)
    expect(fake.remoteSettings).toHaveLength(1)
    expect(service.session()).not.toBeNull()
  })

  it('downloadCloudToLocal keeps the local files untouched when the cloud is unreachable', async () => {
    const failing = (() =>
      Promise.reject(new Error('connection refused'))) as unknown as typeof fetch
    const service = new CloudService({
      sessions,
      localAccounts: local,
      defaultUrl: URL,
      localSecrets,
      localSettings,
      fetchFn: failing,
    })
    await seedLocal()
    writeFileSync(join(directory, 'auth.json'), '{"version":1,"accounts":[]}')
    localSecrets.write({ name: 'search.tavily', value: 'tvly-1' })
    localSettings.write({ values: { 'appearance.accent': 'moss' } })
    signIn()

    const failure = await service.downloadCloudToLocal().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect(existsSync(join(directory, 'auth.json'))).toBe(true)
    expect(localSecrets.read('search.tavily')).toBe('tvly-1')
    expect(localSettings.read().document.values).toEqual({ 'appearance.accent': 'moss' })
    expect((await local.list()).length).toBe(2)
  })

  it('downloadCloudToLocal changes nothing locally when a later domain fails to download', async () => {
    const fake = cloudFake()
    fake.remoteAccounts.push({
      id: 'acc_remote',
      provider: EAuthProvider.Anthropic,
      kind: EAuthKind.ApiKey,
      origin: EAccountOrigin.Login,
      label: 'remote work',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      secret: secretFor('remote'),
    })
    fake.remoteSecrets.push({ name: 'search.tavily', value: 'tvly-9', updatedAt: '2026-01-01T00:00:00.000Z' })
    fake.remoteMcp.push({
      name: 'linear',
      transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' },
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    fake.remoteSettings.push({
      key: 'sandbox.image',
      value: 'atlas-setting:v1:"img-9"',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    fake.failOn.push('GET /v1/settings')
    const service = serviceWithSettings(fake.fetchFn)
    const seeded = await seedLocal()
    localSecrets.write({ name: 'local.key', value: 'local-1' })
    localSettings.write({ values: { 'appearance.accent': 'moss' } })
    signIn()

    const failure = await service.downloadCloudToLocal().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((await local.list()).map((account) => account.label)).toEqual(['work', 'personal'])
    expect(localSecrets.read('local.key')).toBe('local-1')
    expect(localSecrets.read('search.tavily')).toBeUndefined()
    expect(localSettings.read().document.values).toEqual({ 'appearance.accent': 'moss' })
    expect(existsSync(join(directory, 'mcp.json'))).toBe(false)
    expect(await local.activeFor(EAuthProvider.Anthropic)).toBe(seeded.anthropic.id)
    expect(service.session()).not.toBeNull()
  })

  it('downloadCloudToLocal refuses and changes nothing when a remote MCP server is malformed', async () => {
    const fake = cloudFake()
    fake.remoteAccounts.push({
      id: 'acc_remote',
      provider: EAuthProvider.Anthropic,
      kind: EAuthKind.ApiKey,
      origin: EAccountOrigin.Login,
      label: 'remote work',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      secret: secretFor('remote'),
    })
    fake.remoteMcp.push({ name: 'bad name!', updatedAt: '2026-01-01T00:00:00.000Z' })
    const service = serviceWithSettings(fake.fetchFn)
    await seedLocal()
    signIn()

    const failure = await service.downloadCloudToLocal().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((await local.list()).map((account) => account.label)).toEqual(['work', 'personal'])
    expect(existsSync(join(directory, 'mcp.json'))).toBe(false)
  })

  it('downloadCloudToLocal refuses and changes nothing when the cloud has secrets but no local store is wired', async () => {
    const fake = cloudFake()
    fake.remoteAccounts.push({
      id: 'acc_remote',
      provider: EAuthProvider.Anthropic,
      kind: EAuthKind.ApiKey,
      origin: EAccountOrigin.Login,
      label: 'remote work',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      secret: secretFor('remote'),
    })
    fake.remoteSecrets.push({ name: 'search.tavily', value: 'tvly-9', updatedAt: '2026-01-01T00:00:00.000Z' })
    const service = serviceOver(fake.fetchFn)
    await seedLocal()
    signIn()

    const failure = await service.downloadCloudToLocal().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).message).toContain('no local secrets store')
    expect((await local.list()).map((account) => account.label)).toEqual(['work', 'personal'])
  })

  it('refuses to upload or download without a session', async () => {
    const service = serviceWithSettings(cloudFake().fetchFn)

    const uploadFailure = await service.uploadLocalToCloud().catch((error: unknown) => error)
    const downloadFailure = await service.downloadCloudToLocal().catch((error: unknown) => error)

    expect(uploadFailure).toBeInstanceOf(CloudError)
    expect(downloadFailure).toBeInstanceOf(CloudError)
  })
})
