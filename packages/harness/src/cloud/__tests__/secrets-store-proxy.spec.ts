import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SecretCipher } from '../../credentials/secret-cipher'
import { FileSecretsStore } from '../../secrets/file-secrets-store'
import { CloudSessionStore } from '../cloud-session'
import { SecretsStoreProxy } from '../secrets-store-proxy'
import { CloudSignInRequiredError } from '../sign-in-required'

const flushWrites = () => new Promise((resolve) => setImmediate(resolve))

let directory: string
let sessions: CloudSessionStore
let local: FileSecretsStore
let cloudRequired: boolean
let proxy: SecretsStoreProxy

let fetchCalls: {
  url: string
  method: string
  authorization: string | null
  clientVersion: string | null
}[]
const realFetch = globalThis.fetch

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-secrets-proxy-'))
  sessions = new CloudSessionStore({
    file: join(directory, 'cloud.json'),
    keyFile: join(directory, 'key'),
  })
  local = new FileSecretsStore({
    file: join(directory, 'secrets.json'),
    cipher: new SecretCipher(join(directory, 'key')),
  })
  cloudRequired = false
  proxy = new SecretsStoreProxy({ local, sessions, cloudRequired: () => cloudRequired })

  fetchCalls = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    fetchCalls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      authorization: headers.get('authorization'),
      clientVersion: headers.get('atlas-client-version'),
    })
    return new Response(JSON.stringify({ secrets: [{ name: 'remote.key', value: 'cloud-value', updatedAt: '2026-01-01T00:00:00.000Z' }] }), {
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

const thrownBy = (attempt: () => unknown): unknown => {
  try {
    attempt()
  } catch (cause) {
    return cause
  }
  return undefined
}

describe('SecretsStoreProxy with the cloud not required', () => {
  it('serves from the local file store while no session exists', async () => {
    proxy.write({ name: 'search.tavily', value: 'local-value' })
    await proxy.warm()

    expect(proxy.read('search.tavily')).toBe('local-value')
    expect(proxy.origin()).toBe(join(directory, 'secrets.json'))
    expect(fetchCalls).toHaveLength(0)
  })

  it('falls back to local after the session is cleared', async () => {
    signIn('sess_a')
    await proxy.warm()
    expect(fetchCalls).toHaveLength(1)

    sessions.clear()
    proxy.write({ name: 'search.tavily', value: 'local-value' })

    expect(fetchCalls).toHaveLength(1)
    expect(local.read('search.tavily')).toBe('local-value')
  })
})

describe('SecretsStoreProxy with the cloud required', () => {
  beforeEach(() => {
    cloudRequired = true
  })

  it('answers reads as empty while signed out, so the settings overlay can render the gate', () => {
    expect(proxy.read('search.tavily')).toBeUndefined()
    expect(proxy.origin()).toBe('Atlas Cloud (signed out)')

    expect(local.read('search.tavily')).toBeUndefined()
    expect(fetchCalls).toHaveLength(0)
  })

  it('throws CloudSignInRequiredError from writes while signed out', () => {
    const attempts: (() => unknown)[] = [
      () => proxy.write({ name: 'search.tavily', value: 'x' }),
      () => proxy.remove('search.tavily'),
    ]

    for (const attempt of attempts) {
      const failure = thrownBy(attempt)
      expect(failure).toBeInstanceOf(CloudSignInRequiredError)
      expect((failure as Error).message).toBe('sign in to Atlas Cloud first — /auth')
    }

    expect(local.read('search.tavily')).toBeUndefined()
    expect(fetchCalls).toHaveLength(0)
  })

  it('warm resolves without touching anything while signed out', async () => {
    local.write({ name: 'search.tavily', value: 'local-value' })

    await proxy.warm()

    expect(fetchCalls).toHaveLength(0)
    expect(proxy.read('search.tavily')).toBeUndefined()
  })

  it('flips live: local while off, empty while on and signed out', () => {
    cloudRequired = false
    proxy.write({ name: 'search.tavily', value: 'local-value' })
    expect(proxy.read('search.tavily')).toBe('local-value')

    cloudRequired = true
    expect(proxy.read('search.tavily')).toBeUndefined()
    expect(proxy.origin()).toBe('Atlas Cloud (signed out)')

    cloudRequired = false
    expect(proxy.read('search.tavily')).toBe('local-value')
  })
})

describe('SecretsStoreProxy with a session', () => {
  it('warm no-ops when local, and warms the remote once a session exists', async () => {
    signIn('sess_a')

    await proxy.warm()

    expect(proxy.read('remote.key')).toBe('cloud-value')
    expect(proxy.origin()).toBe('http://cloud.test/v1/secrets')
    expect(fetchCalls[0]).toMatchObject({
      url: 'http://cloud.test/v1/secrets',
      method: 'GET',
      authorization: 'Bearer sess_a',
    })
  })

  it('routes writes to the cloud once a session exists', async () => {
    signIn('sess_a')
    await proxy.warm()

    proxy.write({ name: 'new.key', value: 'fresh' })
    await flushWrites()

    expect(proxy.read('new.key')).toBe('fresh')
    expect(fetchCalls.at(-1)).toMatchObject({
      url: 'http://cloud.test/v1/secrets/new.key',
      method: 'PUT',
    })
    expect(local.read('new.key')).toBeUndefined()
  })

  it('rebuilds the remote store when the session token changes', async () => {
    signIn('sess_a')
    await proxy.warm()
    expect(proxy.read('remote.key')).toBe('cloud-value')

    signIn('sess_b')
    expect(proxy.read('remote.key')).toBeUndefined()

    await proxy.warm()
    expect(fetchCalls.map((call) => call.authorization)).toEqual([
      'Bearer sess_a',
      'Bearer sess_b',
    ])
  })

  it('reuses the remote store while the token is unchanged', async () => {
    signIn('sess_a')
    await proxy.warm()
    expect(proxy.read('remote.key')).toBe('cloud-value')
    expect(proxy.read('remote.key')).toBe('cloud-value')

    expect(fetchCalls).toHaveLength(1)
  })

  it('sends the wired client version on remote calls', async () => {
    proxy = new SecretsStoreProxy({
      local,
      sessions,
      clientVersion: '1.2.3',
      cloudRequired: () => cloudRequired,
    })
    signIn('sess_a')

    await proxy.warm()

    expect(fetchCalls[0]?.clientVersion).toBe('1.2.3')
  })
})
