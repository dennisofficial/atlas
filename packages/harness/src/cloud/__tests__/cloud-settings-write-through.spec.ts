import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ATLAS_SETTINGS, ESettingId, LogPort, type ClockPort, type LogEntry } from '@dltech/atlas-core'

import { CloudSessionStore } from '../cloud-session'
import { CloudSettingsStore } from '../cloud-settings-store'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService, type SettingsService } from '../../settings/service'
import { bindCloudSettingsWriteThrough, type WriteThroughBinding } from '../cloud-settings-write-through'
import { encodeSettingValue } from '../sync-settings'

const URL = 'http://cloud.test'

let nowMs = 0
const clock: ClockPort = { now: () => new Date(nowMs).toISOString() }

type ApiFake = {
  calls: { method: string; path: string; body?: unknown }[]
  fetchFn: typeof fetch
}

const apiFake = (): ApiFake => {
  const remote = new Map<string, string>()
  const calls: ApiFake['calls'] = []
  const reply = (status: number, payload?: unknown) =>
    new Response(payload === undefined ? null : JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const path = String(input).slice(URL.length)
    const method = init?.method ?? 'GET'
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    calls.push({ method, path, body })
    if (path === '/v1/settings' && method === 'GET') {
      return reply(200, {
        settings: [...remote].map(([key, value]) => ({ key, value, updatedAt: '2026-01-01T00:00:00.000Z' })),
      })
    }
    if (path.startsWith('/v1/settings/') && method === 'PUT') {
      remote.set(path.slice('/v1/settings/'.length), String(body?.['value']))
      return reply(204)
    }
    return reply(404, { message: `unhandled ${method} ${path}` })
  }) as typeof fetch
  return { calls, fetchFn }
}

let directory: string
let sessions: CloudSessionStore
let api: ApiFake
let store: CloudSettingsStore
let settings: SettingsService
let warnings: string[]

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-write-through-'))
  sessions = new CloudSessionStore({
    file: join(directory, 'cloud.json'),
    keyFile: join(directory, 'key'),
  })
  api = apiFake()
  store = new CloudSettingsStore({ sessions, clock, fetchFn: api.fetchFn })
  settings = createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new MemorySettingsStore(),
  })
  warnings = []
})

afterEach(() => {
  settings.close()
  rmSync(directory, { recursive: true, force: true })
})

const signIn = () => sessions.write({ url: URL, token: 'sess_a', email: 'a@b.c' })

const puts = () => api.calls.filter((call) => call.method === 'PUT')

class CapturingLog extends LogPort {
  record(entry: LogEntry): void {
    warnings.push(entry.message)
  }
}

const bindWithStore = (): WriteThroughBinding =>
  bindCloudSettingsWriteThrough({ settings, store: () => store, log: new CapturingLog() })

describe('bindCloudSettingsWriteThrough', () => {
  it('pushes the encoded value to the API when the key changes while signed in', async () => {
    signIn()
    const binding = bindWithStore()

    settings.set({ id: ESettingId.PrVerdictTiming, value: 'settled' })
    await binding.idle()

    expect(puts()).toHaveLength(1)
    expect(puts()[0]?.path).toBe(`/v1/settings/${ESettingId.PrVerdictTiming}`)
    expect(puts()[0]?.body).toEqual({ value: encodeSettingValue('settled') })
  })

  it('stays silent while signed out, so a toggle stays local until the next explicit upload', async () => {
    const binding = bindWithStore()

    settings.set({ id: ESettingId.PrVerdictTiming, value: 'settled' })
    await binding.idle()

    expect(api.calls).toHaveLength(0)
  })

  it('ignores changes to any other key', async () => {
    signIn()
    const binding = bindWithStore()

    settings.set({ id: ESettingId.SidebarWidth, value: 60 })
    settings.set({ id: ESettingId.GrillingCeremony, value: true })
    await binding.idle()

    expect(api.calls).toHaveLength(0)
  })

  it('lets the latest value win across rapid repeats, one PUT each', async () => {
    signIn()
    const binding = bindWithStore()

    settings.set({ id: ESettingId.PrVerdictTiming, value: 'settled' })
    settings.set({ id: ESettingId.PrVerdictTiming, value: 'fail-fast' })
    await binding.idle()

    expect(puts()).toHaveLength(2)
    expect(puts()[1]?.body).toEqual({ value: encodeSettingValue('fail-fast') })
  })

  it('cannot echo back: the store writes the API and refreshes its cache without touching local settings', async () => {
    signIn()
    const binding = bindWithStore()

    settings.set({ id: ESettingId.PrVerdictTiming, value: 'settled' })
    await binding.idle()

    const document = settings.snapshot().document
    expect(document.values[ESettingId.PrVerdictTiming]).toBe('settled')
    expect(Object.keys(document.values)).toEqual([ESettingId.PrVerdictTiming])
  })

  it('warns on a refused push and still sends the latest value on the next change', async () => {
    signIn()
    const binding = bindWithStore()

    sessions.clear()
    settings.set({ id: ESettingId.PrVerdictTiming, value: 'settled' })
    await binding.idle()

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(ESettingId.PrVerdictTiming)

    signIn()
    settings.set({ id: ESettingId.PrVerdictTiming, value: 'fail-fast' })
    await binding.idle()

    expect(puts()).toHaveLength(1)
    expect(puts()[0]?.body).toEqual({ value: encodeSettingValue('fail-fast') })
  })

  it('stops listening once disposed', async () => {
    signIn()
    const binding = bindWithStore()
    binding.dispose()

    settings.set({ id: ESettingId.PrVerdictTiming, value: 'settled' })
    await binding.idle()

    expect(api.calls).toHaveLength(0)
  })
})
