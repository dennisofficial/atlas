import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
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
}

const cloudFake = (): CloudFake => {
  const fake: CloudFake = {
    added: [],
    actives: [],
    remoteAccounts: [],
    fetchFn: undefined as unknown as typeof fetch,
  }

  fake.fetchFn = (async (input: unknown, init?: RequestInit) => {
    const path = String(input).slice(URL.length)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined

    const reply = (status: number, payload?: unknown) =>
      new Response(payload === undefined ? null : JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      })

    if (path === '/v1/health') return reply(200, { status: 'ok' })
    if (path === '/api/auth/device/code') return reply(200, deviceCodeBody)
    if (path === '/api/auth/get-session')
      return reply(200, { user: { email: 'dev@example.com', name: 'Dev' }, session: {} })
    if (path === '/v1/accounts' && method === 'GET') return reply(200, fake.remoteAccounts)
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

    return reply(404, { message: `unhandled ${method} ${path}` })
  }) as typeof fetch

  return fake
}

let directory: string
let sessions: CloudSessionStore
let local: AccountStore

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-cloud-service-'))
  sessions = new CloudSessionStore({
    file: join(directory, 'cloud.json'),
    keyFile: join(directory, 'key'),
  })
  local = memoryAccountStore({ clock })
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

const serviceOver = (fetchFn: typeof fetch) =>
  new CloudService({ sessions, localAccounts: local, defaultUrl: URL, fetchFn })

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
})
