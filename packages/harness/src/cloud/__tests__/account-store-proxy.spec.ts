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
import { AccountStoreProxy } from '../account-store-proxy'
import { CloudSessionStore } from '../cloud-session'

const clock: ClockPort = { now: () => '2026-01-01T00:00:00.000Z' }

const secret: AccountSecret = { kind: EAuthKind.ApiKey, apiKey: 'sk-test' }

const accountBody = {
  id: 'acc_remote_1',
  provider: EAuthProvider.Anthropic,
  kind: EAuthKind.ApiKey,
  origin: EAccountOrigin.Login,
  label: 'remote',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

let directory: string
let sessions: CloudSessionStore
let local: AccountStore
let proxy: AccountStoreProxy

let fetchCalls: { url: string; authorization: string | null }[]
const realFetch = globalThis.fetch

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-proxy-'))
  sessions = new CloudSessionStore({
    file: join(directory, 'cloud.json'),
    keyFile: join(directory, 'key'),
  })
  local = memoryAccountStore({ clock })
  proxy = new AccountStoreProxy({ local, sessions })

  fetchCalls = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    fetchCalls.push({ url: String(url), authorization: headers.get('authorization') })
    return new Response(JSON.stringify([accountBody]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  rmSync(directory, { recursive: true, force: true })
})

const signIn = (token: string) =>
  sessions.write({ url: 'http://cloud.test', token, email: 'a@b.c' })

describe('AccountStoreProxy', () => {
  it('serves from the local store while no session exists', async () => {
    await proxy.add({
      provider: EAuthProvider.Anthropic,
      label: 'local',
      secret,
      origin: EAccountOrigin.Login,
    })

    expect(await local.list()).toHaveLength(1)
    expect(fetchCalls).toHaveLength(0)
  })

  it('serves from the cloud once a session exists', async () => {
    signIn('sess_a')

    const accounts = await proxy.list()

    expect(accounts[0]?.label).toBe('remote')
    expect(fetchCalls[0]?.url).toBe('http://cloud.test/v1/accounts')
    expect(fetchCalls[0]?.authorization).toBe('Bearer sess_a')
  })

  it('rebuilds the remote store when the session token changes', async () => {
    signIn('sess_a')
    await proxy.list()

    signIn('sess_b')
    await proxy.list()

    expect(fetchCalls.map((call) => call.authorization)).toEqual([
      'Bearer sess_a',
      'Bearer sess_b',
    ])
  })

  it('reuses the remote store while the token is unchanged', async () => {
    signIn('sess_a')
    await proxy.list()
    await proxy.list()

    expect(fetchCalls.map((call) => call.authorization)).toEqual([
      'Bearer sess_a',
      'Bearer sess_a',
    ])
  })

  it('falls back to local after the session is cleared', async () => {
    signIn('sess_a')
    await proxy.list()
    expect(fetchCalls).toHaveLength(1)

    sessions.clear()
    await proxy.add({
      provider: EAuthProvider.Anthropic,
      label: 'local',
      secret,
      origin: EAccountOrigin.Login,
    })

    expect(fetchCalls).toHaveLength(1)
    expect(await local.list()).toHaveLength(1)
  })
})
