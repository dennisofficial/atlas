import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ClockPort } from '@dltech/atlas-core'

import { CloudError } from '../cloud-client'
import { CloudSessionStore } from '../cloud-session'
import { CLOUD_SETTINGS_TTL_MS, CloudSettingsStore } from '../cloud-settings-store'

const URL = 'http://cloud.test'

let nowMs = 0
const clock: ClockPort = { now: () => new Date(nowMs).toISOString() }

type SettingsFake = {
  fetchFn: typeof fetch
  remote: Map<string, string>
  calls: { method: string; path: string; body?: unknown }[]
  status: number
}

const settingsFake = (): SettingsFake => {
  const fake: SettingsFake = {
    remote: new Map(),
    calls: [],
    status: 200,
    fetchFn: undefined as unknown as typeof fetch,
  }

  fake.fetchFn = (async (input: unknown, init?: RequestInit) => {
    const path = String(input).slice(URL.length)
    const method = init?.method ?? 'GET'
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    fake.calls.push({ method, path, body })

    const reply = (status: number, payload?: unknown) =>
      new Response(payload === undefined ? null : JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      })

    if (fake.status !== 200) return reply(fake.status, { message: 'nope' })

    if (path === '/v1/settings' && method === 'GET') {
      return reply(200, {
        settings: [...fake.remote].map(([key, value]) => ({
          key,
          value,
          updatedAt: '2026-01-01T00:00:00.000Z',
        })),
      })
    }
    if (path.startsWith('/v1/settings/') && method === 'PUT') {
      fake.remote.set(path.slice('/v1/settings/'.length), String(body?.['value']))
      return reply(204)
    }
    if (path.startsWith('/v1/settings/') && method === 'DELETE') {
      fake.remote.delete(path.slice('/v1/settings/'.length))
      return reply(204)
    }
    return reply(404, { message: `unhandled ${method} ${path}` })
  }) as typeof fetch

  return fake
}

let directory: string
let sessions: CloudSessionStore
let fake: SettingsFake
let store: CloudSettingsStore

beforeEach(() => {
  nowMs = 0
  directory = mkdtempSync(join(tmpdir(), 'atlas-cloud-settings-'))
  sessions = new CloudSessionStore({
    file: join(directory, 'cloud.json'),
    keyFile: join(directory, 'key'),
  })
  fake = settingsFake()
  store = new CloudSettingsStore({ sessions, clock, fetchFn: fake.fetchFn })
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

const signIn = (token = 'sess_a') => sessions.write({ url: URL, token, email: 'a@b.c' })

const gets = () => fake.calls.filter((call) => call.method === 'GET')

describe('CloudSettingsStore while signed out', () => {
  it('serves no values and never calls the cloud', () => {
    expect(store.values()).toEqual({})
    expect(fake.calls).toHaveLength(0)
  })

  it('refuses writes with a sign-in message', async () => {
    const failure = await store.set({ key: 'sandbox.image', value: 'img' }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(0)
    expect((failure as CloudError).message).toContain('sign in to Atlas Cloud')
    expect(fake.calls).toHaveLength(0)
  })

  it('refuses removes with a sign-in message', async () => {
    const failure = await store.remove({ key: 'sandbox.image' }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(0)
  })
})

describe('CloudSettingsStore reads', () => {
  it('returns the held snapshot synchronously once a refresh has landed', async () => {
    signIn()
    fake.remote.set('sandbox.image', 'img-1')

    expect(store.values()).toEqual({})
    await store.refresh()

    expect(store.values()).toEqual({ 'sandbox.image': 'img-1' })
  })

  it('serves the cache inside the TTL rather than re-fetching', async () => {
    signIn()
    await store.refresh()
    store.values()
    nowMs += CLOUD_SETTINGS_TTL_MS - 1
    store.values()

    expect(gets()).toHaveLength(1)
  })

  it('re-fetches in the background once the TTL has passed, serving stale until it lands', async () => {
    signIn()
    fake.remote.set('sandbox.image', 'img-1')
    await store.refresh()

    nowMs += CLOUD_SETTINGS_TTL_MS + 1
    fake.remote.set('sandbox.image', 'img-2')

    expect(store.values()).toEqual({ 'sandbox.image': 'img-1' })
    await store.refresh()

    expect(store.values()).toEqual({ 'sandbox.image': 'img-2' })
    expect(gets()).toHaveLength(2)
  })

  it('shares one in-flight refresh across concurrent readers', async () => {
    signIn()

    await Promise.all([store.refresh(), store.refresh(), store.refresh()])

    expect(gets()).toHaveLength(1)
  })

  it('notifies subscribers and moves the version when a refresh lands', async () => {
    signIn()
    let told = 0
    store.subscribe(() => {
      told += 1
    })

    await store.refresh()

    expect(told).toBe(1)
    expect(store.version()).toBe(1)
  })

  it('drops the held snapshot when the session token changes', async () => {
    signIn('sess_a')
    fake.remote.set('sandbox.image', 'img-1')
    await store.refresh()

    signIn('sess_b')

    expect(store.values()).toEqual({})
  })
})

describe('CloudSettingsStore writes', () => {
  it('writes through with a PUT, then invalidates and re-reads', async () => {
    signIn()
    fake.remote.set('sandbox.image', 'img-1')
    await store.refresh()

    await store.set({ key: 'sandbox.image', value: 'img-2' })

    const methods = fake.calls.map((call) => `${call.method} ${call.path}`)
    expect(methods).toEqual([
      'GET /v1/settings',
      'PUT /v1/settings/sandbox.image',
      'GET /v1/settings',
    ])
    expect(store.values()).toEqual({ 'sandbox.image': 'img-2' })
  })

  it('removes through with a DELETE, then invalidates and re-reads', async () => {
    signIn()
    fake.remote.set('sandbox.image', 'img-1')
    await store.refresh()

    await store.remove({ key: 'sandbox.image' })

    expect(fake.calls.some((call) => call.method === 'DELETE')).toBe(true)
    expect(store.values()).toEqual({})
  })
})

describe('CloudSettingsStore when the cloud answers badly', () => {
  it.each([401, 402, 403])('ends the session on a %i: cache dropped, session cleared, error rethrown', async (status) => {
    signIn()
    fake.remote.set('sandbox.image', 'img-1')
    await store.refresh()

    nowMs += CLOUD_SETTINGS_TTL_MS + 1
    fake.status = status
    const failure = await store.refresh().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(status)
    expect(store.signedIn()).toBe(false)

    fake.status = 200
    fake.remote.set('sandbox.image', 'img-2')
    await store.refresh()

    expect(store.values()).toEqual({})
  })

  it('serves the stale snapshot through an outage', async () => {
    signIn()
    fake.remote.set('sandbox.image', 'img-1')
    await store.refresh()

    nowMs += CLOUD_SETTINGS_TTL_MS + 1
    fake.status = 500
    await store.refresh()

    expect(store.values()).toEqual({ 'sandbox.image': 'img-1' })
  })

  it('rethrows an outage when nothing is held', async () => {
    signIn()
    fake.status = 500

    const failure = await store.refresh().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(500)
  })
})
