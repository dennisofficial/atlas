import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  clientVersions: { path: string; version: string | null }[]
  failAccountsList: boolean
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
    clientVersions: [],
    failAccountsList: false,
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
    if (path === '/v1/secrets' && method === 'GET') return reply(200, { secrets: fake.remoteSecrets })
    if (path.startsWith('/v1/secrets/') && method === 'PUT') {
      const name = path.slice('/v1/secrets/'.length)
      fake.putSecrets.push({ name, value: body?.['value'] })
      fake.remoteSecrets.push({ name, value: String(body?.['value']), updatedAt: '2026-01-01T00:00:00.000Z' })
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

describe('CloudService', () => {
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

  it('finishLogin records the session, imports local accounts, and copies active pointers', async () => {
    const fake = cloudFake()
    const service = serviceOver(fake.fetchFn)
    const seeded = await seedLocal()

    const ticket = await service.beginLogin()
    const result = await service.finishLogin({ ticket, token: 'sess_new' })

    expect(result.imported).toBe(2)
    expect(result.session).toEqual({ url: URL, token: 'sess_new', email: 'dev@example.com' })
    expect(service.session()).toEqual(result.session)

    expect(fake.added).toEqual([
      {
        provider: EAuthProvider.Anthropic,
        label: 'work',
        secret: secretFor('anthropic'),
        origin: EAccountOrigin.Login,
        email: 'work@example.com',
      },
      {
        provider: EAuthProvider.OpenAI,
        label: 'personal',
        secret: secretFor('openai'),
        origin: EAccountOrigin.Imported,
        importedFrom: 'codex',
      },
    ])

    expect(fake.actives).toEqual([
      { provider: EAuthProvider.Anthropic, accountId: 'acc_remote_1' },
      { provider: EAuthProvider.OpenAI, accountId: 'acc_remote_2' },
    ])
    expect(seeded.anthropic.id).not.toBe('acc_remote_1')
  })

  it('finishLogin imports nothing when the cloud already holds accounts', async () => {
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
    })
    const service = serviceOver(fake.fetchFn)
    await seedLocal()

    const ticket = await service.beginLogin()
    const result = await service.finishLogin({ ticket, token: 'sess_new' })

    expect(result.imported).toBe(0)
    expect(fake.added).toHaveLength(0)
    expect(fake.actives).toHaveLength(0)
    expect(service.session()?.token).toBe('sess_new')
  })

  it('logout clears the session', async () => {
    const fake = cloudFake()
    const service = serviceOver(fake.fetchFn)

    const ticket = await service.beginLogin()
    await service.finishLogin({ ticket, token: 'sess_new' })
    expect(service.session()).not.toBeNull()

    service.logout()
    expect(service.session()).toBeNull()
  })

  it('finishLogin imports local secrets and the user mcp layer when the cloud is empty', async () => {
    const fake = cloudFake()
    const service = serviceWithSecrets(fake.fetchFn)
    localSecrets.write({ name: 'search.tavily', value: 'tvly-1' })
    localSecrets.write({ name: 'search.exa', value: 'exa-1' })
    writeFileSync(
      join(directory, 'mcp.json'),
      JSON.stringify({
        linear: { transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' }, trusted: true },
        paused: { disabled: true },
      }),
    )

    const ticket = await service.beginLogin()
    const result = await service.finishLogin({ ticket, token: 'sess_new' })

    expect(result.importedSecrets).toBe(2)
    expect(result.importedMcp).toBe(2)
    expect(fake.putSecrets).toEqual([
      { name: 'search.tavily', value: 'tvly-1' },
      { name: 'search.exa', value: 'exa-1' },
    ])
    expect(fake.putMcp).toEqual([
      {
        name: 'linear',
        body: { transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' }, trusted: true },
      },
      { name: 'paused', body: { disabled: true } },
    ])
  })

  it('finishLogin skips the secrets and mcp imports when the cloud already holds them', async () => {
    const fake = cloudFake()
    fake.remoteSecrets.push({ name: 'existing', value: 'v', updatedAt: '2026-01-01T00:00:00.000Z' })
    fake.remoteMcp.push({ name: 'existing', disabled: true, updatedAt: '2026-01-01T00:00:00.000Z' })
    const service = serviceWithSecrets(fake.fetchFn)
    localSecrets.write({ name: 'search.tavily', value: 'tvly-1' })
    writeFileSync(
      join(directory, 'mcp.json'),
      JSON.stringify({ linear: { transport: { kind: 'stdio', command: 'npx' } } }),
    )

    const ticket = await service.beginLogin()
    const result = await service.finishLogin({ ticket, token: 'sess_new' })

    expect(result.importedSecrets).toBe(0)
    expect(result.importedMcp).toBe(0)
    expect(fake.putSecrets).toHaveLength(0)
    expect(fake.putMcp).toHaveLength(0)
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

  it('finishLogin skips the secrets import when no local secrets store is wired', async () => {
    const fake = cloudFake()
    const service = serviceOver(fake.fetchFn)
    writeFileSync(
      join(directory, 'mcp.json'),
      JSON.stringify({ linear: { transport: { kind: 'stdio', command: 'npx' } } }),
    )

    const ticket = await service.beginLogin()
    const result = await service.finishLogin({ ticket, token: 'sess_new' })

    expect(result.importedSecrets).toBe(0)
    expect(result.importedMcp).toBe(1)
    expect(fake.putSecrets).toHaveLength(0)
  })

  it('finishLogin archives the local files after the import and returns their paths', async () => {
    const fake = cloudFake()
    const service = serviceWithSecrets(fake.fetchFn)
    writeFileSync(join(directory, 'auth.json'), '{}')
    localSecrets.write({ name: 'search.tavily', value: 'tvly-1' })
    writeFileSync(
      join(directory, 'mcp.json'),
      JSON.stringify({ linear: { transport: { kind: 'stdio', command: 'npx' } } }),
    )

    const ticket = await service.beginLogin()
    const result = await service.finishLogin({ ticket, token: 'sess_new' })

    expect(result.archived).toEqual([
      join(directory, 'auth.json.archived'),
      join(directory, 'secrets.json.archived'),
      join(directory, 'mcp.json.archived'),
    ])
    expect(existsSync(join(directory, 'auth.json'))).toBe(false)
    expect(existsSync(join(directory, 'secrets.json'))).toBe(false)
    expect(existsSync(join(directory, 'mcp.json'))).toBe(false)
    expect(existsSync(join(directory, 'auth.json.archived'))).toBe(true)
    expect(existsSync(join(directory, 'secrets.json.archived'))).toBe(true)
    expect(existsSync(join(directory, 'mcp.json.archived'))).toBe(true)
  })

  it('finishLogin archives even when the cloud was already populated', async () => {
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
    })
    const service = serviceOver(fake.fetchFn)
    writeFileSync(join(directory, 'auth.json'), '{}')

    const ticket = await service.beginLogin()
    const result = await service.finishLogin({ ticket, token: 'sess_new' })

    expect(result.imported).toBe(0)
    expect(result.archived).toEqual([join(directory, 'auth.json.archived')])
    expect(existsSync(join(directory, 'auth.json'))).toBe(false)
  })

  it('finishLogin tolerates local files that are absent or already archived', async () => {
    const fake = cloudFake()
    const service = serviceOver(fake.fetchFn)

    const ticket = await service.beginLogin()
    const result = await service.finishLogin({ ticket, token: 'sess_new' })

    expect(result.archived).toEqual([])
  })

  it('finishLogin archives nothing when the import fails', async () => {
    const fake = cloudFake()
    fake.failAccountsList = true
    const service = serviceWithSecrets(fake.fetchFn)
    writeFileSync(join(directory, 'auth.json'), '{}')
    localSecrets.write({ name: 'search.tavily', value: 'tvly-1' })
    writeFileSync(
      join(directory, 'mcp.json'),
      JSON.stringify({ linear: { transport: { kind: 'stdio', command: 'npx' } } }),
    )

    const ticket = await service.beginLogin()
    const failure = await service
      .finishLogin({ ticket, token: 'sess_new' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect(existsSync(join(directory, 'auth.json'))).toBe(true)
    expect(existsSync(join(directory, 'secrets.json'))).toBe(true)
    expect(existsSync(join(directory, 'mcp.json'))).toBe(true)
    expect(existsSync(join(directory, 'auth.json.archived'))).toBe(false)
    expect(existsSync(join(directory, 'secrets.json.archived'))).toBe(false)
    expect(existsSync(join(directory, 'mcp.json.archived'))).toBe(false)
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
