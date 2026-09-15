import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  toAccountId,
  type AccountSecret,
  type ClockPort,
} from '@dltech/atlas-core'

import { memoryAccountStore, type AccountStore } from '../../credentials/account-store'
import { AccountStoreProxy } from '../account-store-proxy'
import { CloudSessionStore } from '../cloud-session'
import { CloudSignInRequiredError } from '../sign-in-required'

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
let cloudRequired: boolean
let proxy: AccountStoreProxy

let fetchCalls: { url: string; authorization: string | null; clientVersion: string | null }[]
const realFetch = globalThis.fetch

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-proxy-'))
  sessions = new CloudSessionStore({
    file: join(directory, 'cloud.json'),
    keyFile: join(directory, 'key'),
  })
  local = memoryAccountStore({ clock })
  cloudRequired = false
  proxy = new AccountStoreProxy({ local, sessions, cloudRequired: () => cloudRequired })

  fetchCalls = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    fetchCalls.push({
      url: String(url),
      authorization: headers.get('authorization'),
      clientVersion: headers.get('atlas-client-version'),
    })
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

const addLocal = () =>
  proxy.add({
    provider: EAuthProvider.Anthropic,
    label: 'local',
    secret,
    origin: EAccountOrigin.Login,
  })

describe('AccountStoreProxy with the cloud not required', () => {
  it('serves from the local store while no session exists', async () => {
    await addLocal()

    expect(await local.list()).toHaveLength(1)
    expect(fetchCalls).toHaveLength(0)
  })

  it('falls back to local after the session is cleared', async () => {
    signIn('sess_a')
    await proxy.list()
    expect(fetchCalls).toHaveLength(1)

    sessions.clear()
    await addLocal()

    expect(fetchCalls).toHaveLength(1)
    expect(await local.list()).toHaveLength(1)
  })
})

describe('AccountStoreProxy with the cloud required', () => {
  beforeEach(() => {
    cloudRequired = true
  })

  it('throws CloudSignInRequiredError from every method while signed out', async () => {
    const attempts: (() => unknown)[] = [
      () => proxy.list(),
      () => proxy.read(toAccountId('acc_1')),
      () => addLocal(),
      () => proxy.replaceSecret({ accountId: toAccountId('acc_1'), secret }),
      () =>
        proxy.setStatus({ accountId: toAccountId('acc_1'), status: EAccountStatus.Active }),
      () => proxy.remove(toAccountId('acc_1')),
      () =>
        proxy.setActive({ provider: EAuthProvider.Anthropic, accountId: toAccountId('acc_1') }),
      () => proxy.activeFor(EAuthProvider.Anthropic),
    ]

    for (const attempt of attempts) {
      let failure: unknown
      try {
        attempt()
      } catch (cause) {
        failure = cause
      }
      expect(failure).toBeInstanceOf(CloudSignInRequiredError)
      expect((failure as Error).message).toBe('sign in to Atlas Cloud first — /auth')
    }

    expect(await local.list()).toHaveLength(0)
    expect(fetchCalls).toHaveLength(0)
  })

  it('serves from the cloud once a session exists', async () => {
    signIn('sess_a')

    const accounts = await proxy.list()

    expect(accounts[0]?.label).toBe('remote')
    expect(fetchCalls[0]?.url).toBe('http://cloud.test/v1/accounts')
  })

  it('flips live: local while off, refusing while on, local again when flipped back', async () => {
    cloudRequired = false
    await addLocal()
    expect(await proxy.list()).toHaveLength(1)

    cloudRequired = true
    let flipped: unknown
    try {
      proxy.list()
    } catch (cause) {
      flipped = cause
    }
    expect(flipped).toBeInstanceOf(CloudSignInRequiredError)

    cloudRequired = false
    expect(await proxy.list()).toHaveLength(1)
  })
})

describe('AccountStoreProxy with a session', () => {
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

  it('sends the wired client version on remote calls', async () => {
    proxy = new AccountStoreProxy({
      local,
      sessions,
      clientVersion: '1.2.3',
      cloudRequired: () => cloudRequired,
    })
    signIn('sess_a')

    await proxy.list()

    expect(fetchCalls[0]?.clientVersion).toBe('1.2.3')
  })

  it('sends atlas-client-version: dev when no version is wired', async () => {
    signIn('sess_a')

    await proxy.list()

    expect(fetchCalls[0]?.clientVersion).toBe('dev')
  })
})
