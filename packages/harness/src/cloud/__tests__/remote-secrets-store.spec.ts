import { describe, expect, it } from 'bun:test'

import { CloudClient, CloudError } from '../cloud-client'
import { RemoteSecretsStore } from '../remote-secrets-store'

type Recorded = { url: string; method: string; body: unknown }

const storeWith = (
  respond: (call: Recorded) => { status: number; body?: unknown },
): { store: RemoteSecretsStore; calls: Recorded[] } => {
  const calls: Recorded[] = []

  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const call: Recorded = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)

    const answer = respond(call)
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const client = new CloudClient({ url: 'http://cloud.test/', token: 'sess_test', fetchFn })
  return { store: new RemoteSecretsStore({ client }), calls }
}

const warmWith = (secrets: Record<string, string>) =>
  storeWith(() => ({
    status: 200,
    body: {
      secrets: Object.entries(secrets).map(([name, value]) => ({
        name,
        value,
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
    },
  }))

describe('RemoteSecretsStore', () => {
  it('warm fills the in-memory map and origin points at the remote collection', async () => {
    const { store } = warmWith({ 'search.tavily': 'tvly-1', 'search.exa': 'exa-1' })

    await store.warm()

    expect(store.read('search.tavily')).toBe('tvly-1')
    expect(store.read('search.exa')).toBe('exa-1')
    expect(store.origin()).toBe('http://cloud.test/v1/secrets')
  })

  it('reads are synchronous from memory, undefined before warm', () => {
    const { store } = warmWith({})

    expect(store.read('search.tavily')).toBeUndefined()
  })

  it('write updates memory immediately and enqueues a PUT, remove a DELETE, in order', async () => {
    const { store, calls } = storeWith(({ method }) =>
      method === 'GET' ? { status: 200, body: { secrets: [] } } : { status: 204 },
    )
    await store.warm()

    store.write({ name: 'a', value: '1' })
    store.write({ name: 'b', value: '2' })
    store.remove('a')

    expect(store.read('a')).toBeUndefined()
    expect(store.read('b')).toBe('2')

    await store.settled()

    expect(calls.slice(1)).toEqual([
      { url: 'http://cloud.test/v1/secrets/a', method: 'PUT', body: { value: '1' } },
      { url: 'http://cloud.test/v1/secrets/b', method: 'PUT', body: { value: '2' } },
      { url: 'http://cloud.test/v1/secrets/a', method: 'DELETE', body: undefined },
    ])
    expect(store.failure).toBeNull()
  })

  it('settled rejects with the first failure and records it, keeping the in-memory value', async () => {
    const { store } = storeWith(({ method, url }) =>
      method === 'PUT' && url.endsWith('/doomed')
        ? { status: 500, body: { message: 'vault sealed' } }
        : { status: 200, body: { secrets: [] } },
    )
    await store.warm()

    store.write({ name: 'doomed', value: 'x' })
    store.write({ name: 'also-doomed', value: 'y' })

    const failure = await store.settled().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(500)
    expect(store.failure?.message).toContain('vault sealed')
    expect(store.read('doomed')).toBe('x')
  })

  it('clears the recorded failure after a successful drain', async () => {
    let open = false
    const { store } = storeWith(({ method }) => {
      if (method === 'GET') return { status: 200, body: { secrets: [] } }
      return open ? { status: 204 } : { status: 500, body: { message: 'down' } }
    })
    await store.warm()

    store.write({ name: 'a', value: '1' })
    await expect(store.settled()).rejects.toBeInstanceOf(CloudError)
    expect(store.failure).not.toBeNull()

    open = true
    store.write({ name: 'a', value: '2' })
    await store.settled()

    expect(store.failure).toBeNull()
  })

  it('warm failure throws a CloudError rather than falling back', async () => {
    const { store } = storeWith(() => ({ status: 503, body: { message: 'offline' } }))

    const failure = await store.warm().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(503)
  })
})
