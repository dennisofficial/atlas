import { describe, expect, it } from 'bun:test'

import { MemorySettingsStore } from '../../settings/memory-store'
import { CloudClient, CloudError } from '../cloud-client'
import { downloadRemoteSettings, uploadLocalSettings } from '../sync-settings'

type SettingsFake = {
  fetchFn: typeof fetch
  remote: { key: string; value: string; updatedAt: string }[]
  put: { key: string; value: unknown }[]
  deletedKeys: string[]
  failList: boolean
}

const settingsFake = (): SettingsFake => {
  const fake: SettingsFake = {
    remote: [],
    put: [],
    deletedKeys: [],
    failList: false,
    fetchFn: undefined as unknown as typeof fetch,
  }

  const reply = (status: number, payload?: unknown) =>
    new Response(payload === undefined ? null : JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  fake.fetchFn = (async (input: unknown, init?: RequestInit) => {
    const path = String(input).replace('http://cloud.test', '')
    const method = init?.method ?? 'GET'
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined

    if (path === '/v1/settings' && method === 'GET') {
      if (fake.failList) return reply(500, { message: 'listing broke' })
      return reply(200, { settings: fake.remote })
    }
    if (path.startsWith('/v1/settings/') && method === 'PUT') {
      const key = path.slice('/v1/settings/'.length)
      fake.put.push({ key, value: body?.['value'] })
      return reply(204)
    }
    if (path.startsWith('/v1/settings/') && method === 'DELETE') {
      fake.deletedKeys.push(path.slice('/v1/settings/'.length))
      return reply(204)
    }
    return reply(404, { message: `unhandled ${method} ${path}` })
  }) as typeof fetch

  return fake
}

const clientOver = (fetchFn: typeof fetch) =>
  new CloudClient({ url: 'http://cloud.test', token: 't', fetchFn })

describe('uploadLocalSettings', () => {
  it('envelope-encodes every local setting, empty strings included', async () => {
    const fake = settingsFake()
    const local = new MemorySettingsStore()
    local.write({
      values: {
        'appearance.accent': 'moss',
        'appearance.theme': '',
        'sidebar.width': 42,
        'updates.enabled': true,
        'updates.beta': false,
      },
    })

    const count = await uploadLocalSettings({ client: clientOver(fake.fetchFn), localSettings: local })

    expect(count).toBe(5)
    expect(fake.put).toEqual([
      { key: 'appearance.accent', value: 'atlas-setting:v1:"moss"' },
      { key: 'appearance.theme', value: 'atlas-setting:v1:""' },
      { key: 'sidebar.width', value: 'atlas-setting:v1:42' },
      { key: 'updates.enabled', value: 'atlas-setting:v1:true' },
      { key: 'updates.beta', value: 'atlas-setting:v1:false' },
    ])
  })

  it('returns zero when no local settings store is wired', async () => {
    const fake = settingsFake()
    const count = await uploadLocalSettings({
      client: clientOver(fake.fetchFn),
      localSettings: undefined,
    })
    expect(count).toBe(0)
  })
})

describe('downloadRemoteSettings', () => {
  it('merges remote settings over the local document without dropping unrelated keys', async () => {
    const fake = settingsFake()
    fake.remote.push({ key: 'sandbox.image', value: 'img-1', updatedAt: '2026-01-01T00:00:00.000Z' })
    const local = new MemorySettingsStore()
    local.write({ values: { 'appearance.accent': 'moss', 'sandbox.image': 'old' } })

    const count = await downloadRemoteSettings({
      client: clientOver(fake.fetchFn),
      localSettings: local,
      purge: false,
    })

    expect(count).toBe(1)
    expect(local.read().document.values).toEqual({
      'appearance.accent': 'moss',
      'sandbox.image': 'img-1',
    })
    expect(fake.deletedKeys).toEqual([])
  })

  it('roundtrips envelope-encoded literals with their types intact', async () => {
    const fake = settingsFake()
    fake.remote.push(
      { key: 'a.number', value: 'atlas-setting:v1:42', updatedAt: '2026-01-01T00:00:00.000Z' },
      { key: 'a.true', value: 'atlas-setting:v1:true', updatedAt: '2026-01-01T00:00:00.000Z' },
      { key: 'a.false', value: 'atlas-setting:v1:false', updatedAt: '2026-01-01T00:00:00.000Z' },
      { key: 'a.string', value: 'atlas-setting:v1:"moss"', updatedAt: '2026-01-01T00:00:00.000Z' },
      { key: 'a.empty', value: 'atlas-setting:v1:""', updatedAt: '2026-01-01T00:00:00.000Z' },
    )
    const local = new MemorySettingsStore()

    const count = await downloadRemoteSettings({
      client: clientOver(fake.fetchFn),
      localSettings: local,
      purge: false,
    })

    expect(count).toBe(5)
    expect(local.read().document.values).toEqual({
      'a.number': 42,
      'a.true': true,
      'a.false': false,
      'a.string': 'moss',
      'a.empty': '',
    })
  })

  it('keeps legacy plain strings as strings, even ones that read as literals', async () => {
    const fake = settingsFake()
    fake.remote.push(
      { key: 'legacy.word', value: 'img-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      { key: 'legacy.true', value: 'true', updatedAt: '2026-01-01T00:00:00.000Z' },
      { key: 'legacy.number', value: '42', updatedAt: '2026-01-01T00:00:00.000Z' },
      { key: 'legacy.broken', value: 'atlas-setting:v1:not-json', updatedAt: '2026-01-01T00:00:00.000Z' },
    )
    const local = new MemorySettingsStore()

    await downloadRemoteSettings({
      client: clientOver(fake.fetchFn),
      localSettings: local,
      purge: false,
    })

    expect(local.read().document.values).toEqual({
      'legacy.word': 'img-1',
      'legacy.true': 'true',
      'legacy.number': '42',
      'legacy.broken': 'atlas-setting:v1:not-json',
    })
  })

  it('retains the raw string when a prefixed payload decodes to a non-scalar', async () => {
    const fake = settingsFake()
    fake.remote.push(
      { key: 'bad.array', value: 'atlas-setting:v1:["a"]', updatedAt: '2026-01-01T00:00:00.000Z' },
      { key: 'bad.null', value: 'atlas-setting:v1:null', updatedAt: '2026-01-01T00:00:00.000Z' },
      { key: 'bad.object', value: 'atlas-setting:v1:{"a":1}', updatedAt: '2026-01-01T00:00:00.000Z' },
    )
    const local = new MemorySettingsStore()

    await downloadRemoteSettings({
      client: clientOver(fake.fetchFn),
      localSettings: local,
      purge: false,
    })

    expect(local.read().document.values).toEqual({
      'bad.array': 'atlas-setting:v1:["a"]',
      'bad.null': 'atlas-setting:v1:null',
      'bad.object': 'atlas-setting:v1:{"a":1}',
    })
  })

  it('deletes the remote keys after landing when purging', async () => {
    const fake = settingsFake()
    fake.remote.push(
      { key: 'sandbox.image', value: 'img-1', updatedAt: '2026-01-01T00:00:00.000Z' },
      { key: 'cloud.url', value: 'https://x', updatedAt: '2026-01-01T00:00:00.000Z' },
    )
    const local = new MemorySettingsStore()

    const count = await downloadRemoteSettings({
      client: clientOver(fake.fetchFn),
      localSettings: local,
      purge: true,
    })

    expect(count).toBe(2)
    expect(local.read().document.values).toEqual({
      'sandbox.image': 'img-1',
      'cloud.url': 'https://x',
    })
    expect(fake.deletedKeys).toEqual(['sandbox.image', 'cloud.url'])
  })

  it('writes nothing locally when the remote list cannot be read', async () => {
    const fake = settingsFake()
    fake.failList = true
    const local = new MemorySettingsStore()
    local.write({ values: { 'appearance.accent': 'moss' } })

    const failure = await downloadRemoteSettings({
      client: clientOver(fake.fetchFn),
      localSettings: local,
      purge: false,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect(local.read().document.values).toEqual({ 'appearance.accent': 'moss' })
  })

  it('throws a clear error when remote settings exist but no local store is wired', async () => {
    const fake = settingsFake()
    fake.remote.push({ key: 'sandbox.image', value: 'img-1', updatedAt: '2026-01-01T00:00:00.000Z' })

    const failure = await downloadRemoteSettings({
      client: clientOver(fake.fetchFn),
      localSettings: undefined,
      purge: false,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).message).toContain('no local settings store')
  })
})
