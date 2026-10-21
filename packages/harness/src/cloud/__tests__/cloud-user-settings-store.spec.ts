import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ENoticeTone, type ClockPort, type NoticePost } from '@dltech/atlas-core'

import { MemorySettingsStore } from '../../settings/memory-store'
import { CloudSessionStore } from '../cloud-session'
import { CloudSettingsStore } from '../cloud-settings-store'
import { CloudUserSettingsStore } from '../cloud-user-settings-store'
import { encodeSettingValue } from '../sync-settings'

const URL = 'http://cloud.test'
const clock: ClockPort = { now: () => new Date(0).toISOString() }
const LOCAL_ONLY = new Set(['appearance.accent'])

let directory: string
let sessions: CloudSessionStore
let remote: Map<string, string>
let failPuts: boolean
let calls: string[]
let puts: { path: string; authorization: string | null }[]
let gate: Promise<void> | undefined
let posts: NoticePost[]
let changes: number
let local: MemorySettingsStore
let cloud: CloudSettingsStore
let store: CloudUserSettingsStore

const fetchFn = (async (input: unknown, init?: RequestInit) => {
  const path = String(input).slice(URL.length)
  const method = init?.method ?? 'GET'
  calls.push(`${method} ${path}`)
  const reply = (args: { status: number; payload?: unknown }) =>
    new Response(args.payload === undefined ? null : JSON.stringify(args.payload), {
      status: args.status,
      headers: { 'content-type': 'application/json' },
    })
  if (path === '/v1/settings' && method === 'GET') {
    return reply({
      status: 200,
      payload: {
        settings: [...remote].map(([key, value]) => ({ key, value, updatedAt: '2026-01-01T00:00:00.000Z' })),
      },
    })
  }
  if (path.startsWith('/v1/settings/') && method === 'PUT') {
    puts.push({ path, authorization: new Headers(init?.headers).get('authorization') })
    if (gate !== undefined) await gate
    if (failPuts) return reply({ status: 500, payload: { message: 'boom' } })
    const body = JSON.parse(String(init?.body)) as { value: string }
    remote.set(path.slice('/v1/settings/'.length), body.value)
    return reply({ status: 204 })
  }
  if (path.startsWith('/v1/settings/') && method === 'DELETE') {
    remote.delete(path.slice('/v1/settings/'.length))
    return reply({ status: 204 })
  }
  return reply({ status: 404, payload: {} })
}) as typeof fetch

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-cloud-user-settings-'))
  sessions = new CloudSessionStore({ file: join(directory, 'cloud.json'), keyFile: join(directory, 'key') })
  remote = new Map()
  failPuts = false
  calls = []
  puts = []
  gate = undefined
  posts = []
  changes = 0
  local = new MemorySettingsStore({ label: 'local file' })
  cloud = new CloudSettingsStore({ sessions, clock, fetchFn })
  store = new CloudUserSettingsStore({
    local,
    cloud,
    localOnly: LOCAL_ONLY,
    notice: { notify: (post) => posts.push(post) },
    onChange: () => {
      changes += 1
    },
  })
})

afterEach(() => {
  store.close()
  rmSync(directory, { recursive: true, force: true })
})

const signIn = (token = 'sess') => sessions.write({ url: URL, token, email: null })

const settled = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) await Bun.sleep(5)
}

describe('CloudUserSettingsStore signed out', () => {
  it('behaves exactly as the local store and never calls the cloud', () => {
    store.write({ values: { 'transcript.smoothStreaming': false, 'appearance.accent': 'moss' } })

    expect(store.read().document.values).toEqual({ 'transcript.smoothStreaming': false, 'appearance.accent': 'moss' })
    expect(store.origin()).toBe('local file')
    expect(calls).toEqual([])
  })
})

describe('CloudUserSettingsStore signed in', () => {
  it('merges decoded cloud values with the local-only keys from the file', async () => {
    signIn()
    remote.set('transcript.smoothStreaming', encodeSettingValue(false))
    remote.set('appearance.accent', encodeSettingValue('slate'))
    local.write({ values: { 'appearance.accent': 'moss', 'transcript.thinkingBlocks': 'hidden' } })
    await cloud.refresh()

    expect(store.read().document.values).toEqual({
      'transcript.smoothStreaming': false,
      'appearance.accent': 'moss',
    })
    expect(store.origin()).toBe('Atlas Cloud settings')
  })

  it('splits a write: local-only keys to the file, the rest to the cloud', async () => {
    signIn()
    await cloud.refresh()
    calls = []

    store.write({ values: { 'appearance.accent': 'moss', 'transcript.thinkingBlocks': 'hidden' } })
    await settled()

    expect(local.document().values).toEqual({ 'appearance.accent': 'moss' })
    expect(calls.filter((call) => call.startsWith('PUT'))).toEqual(['PUT /v1/settings/transcript.thinkingBlocks'])
    expect(remote.get('transcript.thinkingBlocks')).toBe(encodeSettingValue('hidden'))
  })

  it('reads its own write back immediately, before the cloud answers', async () => {
    signIn()
    await cloud.refresh()

    store.write({ values: { 'transcript.thinkingBlocks': 'hidden' } })

    expect(store.read().document.values['transcript.thinkingBlocks']).toBe('hidden')
  })

  it('sends only the diff: unchanged keys are not rewritten and dropped keys are deleted', async () => {
    signIn()
    remote.set('transcript.smoothStreaming', encodeSettingValue(false))
    remote.set('transcript.thinkingBlocks', encodeSettingValue('hidden'))
    await cloud.refresh()
    calls = []

    store.write({ values: { 'transcript.smoothStreaming': false } })
    await settled()

    expect(calls.filter((call) => call !== 'GET /v1/settings')).toEqual(['DELETE /v1/settings/transcript.thinkingBlocks'])
    expect(remote.has('transcript.thinkingBlocks')).toBe(false)
  })

  it('keeps serving the last cloud values while a refresh is in flight, so a second write cannot delete them', async () => {
    signIn()
    remote.set('transcript.smoothStreaming', encodeSettingValue(false))
    await cloud.refresh()
    expect(store.read().document.values['transcript.smoothStreaming']).toBe(false)

    cloud.invalidate()
    expect(store.read().document.values['transcript.smoothStreaming']).toBe(false)
    store.write({ values: { ...store.read().document.values, 'transcript.thinkingBlocks': 'hidden' } })
    await settled()

    expect(calls.filter((call) => call.startsWith('DELETE'))).toEqual([])
    expect(remote.get('transcript.smoothStreaming')).toBe(encodeSettingValue(false))
  })

  it('never deletes a cloud copy of a local-only key', async () => {
    signIn()
    remote.set('appearance.accent', encodeSettingValue('slate'))
    await cloud.refresh()
    calls = []

    store.write({ values: {} })
    await settled()

    expect(calls.filter((call) => call.startsWith('DELETE'))).toEqual([])
  })

  it('surfaces a failed cloud write as a notice and republishes so the dropped value disappears', async () => {
    signIn()
    await cloud.refresh()
    failPuts = true
    changes = 0

    store.write({ values: { 'transcript.thinkingBlocks': 'hidden' } })
    await settled()

    expect(posts).toHaveLength(1)
    expect(posts[0]?.tone).toBe(ENoticeTone.Warn)
    expect(posts[0]?.text).toContain('transcript.thinkingBlocks')
    expect(changes).toBeGreaterThan(0)
    expect(store.read().document.values['transcript.thinkingBlocks']).toBeUndefined()
  })

  it('calls onChange when a cloud refresh lands, and stops after close', async () => {
    signIn()
    await cloud.refresh()
    expect(changes).toBeGreaterThan(0)

    store.close()
    const before = changes
    await cloud.refresh()
    expect(changes).toBe(before)
  })

  it('drops a queued write instead of sending it under a different sign-in', async () => {
    signIn('sess')
    await cloud.refresh()
    let release: () => void = () => undefined
    gate = new Promise<void>((resolve) => {
      release = resolve
    })

    store.write({ values: { 'transcript.smoothStreaming': false } })
    await settled()
    store.write({ values: { 'transcript.smoothStreaming': false, 'transcript.thinkingBlocks': 'hidden' } })

    sessions.clear()
    signIn('other')
    release()
    await settled()

    expect(puts.map((put) => put.path)).toEqual(['/v1/settings/transcript.smoothStreaming'])
    expect(puts.every((put) => put.authorization === 'Bearer sess')).toBe(true)
    expect(remote.has('transcript.thinkingBlocks')).toBe(false)
  })
})
