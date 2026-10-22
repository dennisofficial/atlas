import { describe, expect, it } from 'bun:test'

import { CloudClient, CloudError } from '../cloud-client'
import { RemoteSecretsStore } from '../remote-secrets-store'

type Recorded = { url: string; method: string; body: unknown }

type Answer = { status: number; body?: unknown }

const storeWith = (
  respond: (call: Recorded) => Answer | Promise<Answer>,
): { store: RemoteSecretsStore; calls: Recorded[] } => {
  const calls: Recorded[] = []

  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const call: Recorded = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)

    const answer = await respond(call)
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const client = new CloudClient({ url: 'http://cloud.test/', token: 'sess_test', fetchFn })
  return { store: new RemoteSecretsStore({ client }), calls }
}

const noticedStoreWith = (
  respond: (call: Recorded) => Answer | Promise<Answer>,
  onWriteFailure: (args: { name: string; failure: CloudError }) => void,
): RemoteSecretsStore => {
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const call: Recorded = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    const answer = await respond(call)
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  return new RemoteSecretsStore({
    client: new CloudClient({ url: 'http://cloud.test/', token: 'sess_test', fetchFn }),
    onWriteFailure,
  })
}

const secretsBody = (server: Map<string, string>) => ({
  secrets: [...server.entries()].map(([name, value]) => ({
    name,
    value,
    updatedAt: '2026-01-01T00:00:00.000Z',
  })),
})

const deferred = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const statefulCloud = (args?: {
  initial?: Record<string, string>
  holdGet?: () => Promise<void>
  holdPut?: () => Promise<void>
}) => {
  const server = new Map(Object.entries(args?.initial ?? {}))
  const order: string[] = []

  const { store } = storeWith(async ({ method, url, body }) => {
    const name = url.split('/').at(-1) ?? ''
    if (method === 'GET') {
      const snapshot = secretsBody(server)
      order.push('GET')
      await args?.holdGet?.()
      return { status: 200, body: snapshot }
    }
    if (method === 'PUT') {
      order.push(`PUT ${name}`)
      await args?.holdPut?.()
      server.set(name, (body as { value: string }).value)
      return { status: 204 }
    }
    if (method === 'DELETE') {
      server.delete(name)
      return { status: 204 }
    }
    return { status: 204 }
  })

  return { store, server, order }
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

  it('clears the recorded failure after a successful drain', async () => {    let open = false
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

  it('raises each write-behind failure on the callback while settled still rejects', async () => {
    const raised: { name: string; failure: CloudError }[] = []
    const store = noticedStoreWith(
      ({ method, url }) =>
        method === 'PUT' && url.endsWith('/doomed')
          ? { status: 500, body: { message: 'vault sealed' } }
          : { status: 200, body: { secrets: [] } },
      (args) => {
        raised.push(args)
      },
    )
    await store.warm()

    store.write({ name: 'doomed', value: 'x' })
    store.write({ name: 'fine', value: 'y' })

    await expect(store.settled()).rejects.toBeInstanceOf(CloudError)

    expect(raised).toHaveLength(1)
    expect(raised[0]?.name).toBe('doomed')
    expect(raised[0]?.failure.message).toContain('vault sealed')
  })

  it('warm failure throws a CloudError rather than falling back', async () => {
    const { store } = storeWith(() => ({ status: 503, body: { message: 'offline' } }))

    const failure = await store.warm().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(503)
  })

  it('a later warm picks up values another session changed', async () => {
    const { store, server } = statefulCloud({ initial: { 'search.tavily': 'tvly-1' } })

    await store.warm()
    expect(store.read('search.tavily')).toBe('tvly-1')

    server.set('search.tavily', 'tvly-2')
    await store.warm()

    expect(store.read('search.tavily')).toBe('tvly-2')
  })

  it('warm lets queued writes land before fetching, so a re-warm never resurrects a value still flying out', async () => {
    const put = deferred()
    const { store, order } = statefulCloud({ holdPut: () => put.promise })

    store.write({ name: 'a', value: '1' })
    const warming = store.warm()
    await new Promise((resolve) => setImmediate(resolve))

    expect(order).toEqual(['PUT a'])

    put.release()
    await warming

    expect(order).toEqual(['PUT a', 'GET'])
    expect(store.read('a')).toBe('1')
  })

  it('writes landing after a warm starts win over the fetched snapshot', async () => {
    const get = deferred()
    const { store } = statefulCloud({
      initial: { a: '1', b: '1' },
      holdGet: () => get.promise,
    })

    const warming = store.warm()
    store.write({ name: 'b', value: '2' })
    store.remove('a')
    get.release()
    await warming

    expect(store.read('b')).toBe('2')
    expect(store.read('a')).toBeUndefined()
  })

  it('a warm requested while another is in flight joins it rather than fetching again', async () => {
    const get = deferred()
    let gets = 0
    const { store, order } = statefulCloud({
      initial: { a: 'old' },
      holdGet: () => {
        gets += 1
        return gets === 1 ? get.promise : Promise.resolve()
      },
    })

    const first = store.warm()
    store.write({ name: 'a', value: 'mine' })
    const second = store.warm()

    get.release()
    await first
    await second
    await store.settled()

    expect(store.read('a')).toBe('mine')
    expect(order.filter((entry) => entry === 'GET')).toHaveLength(1)
  })

  it('a warm keeps the local value of a write the cloud refused', async () => {
    const { store } = storeWith(({ method, url }) => {
      if (method === 'GET') return { status: 200, body: { secrets: [] } }
      if (method === 'PUT' && url.endsWith('/doomed')) {
        return { status: 500, body: { message: 'vault sealed' } }
      }
      return { status: 204 }
    })
    await store.warm()

    store.write({ name: 'doomed', value: 'x' })
    await expect(store.settled()).rejects.toBeInstanceOf(CloudError)

    await store.warm()

    expect(store.read('doomed')).toBe('x')
  })
})
