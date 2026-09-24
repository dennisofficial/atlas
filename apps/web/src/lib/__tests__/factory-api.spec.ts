import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { UNREACHABLE } from '../auth-api'
import {
  FactoryApiError,
  getFactorySettings,
  listConnections,
  listWorkItems,
  saveDecisionsSettings,
  saveModelSettings,
  saveVercelSettings,
  type FactoryConnection,
} from '../factory-api'

let fetchCalls: { url: string; init?: RequestInit }[]
const realFetch = globalThis.fetch

const answerWith = (response: Response): void => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
    return response
  }) as typeof fetch
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const connection: FactoryConnection = {
  id: 'conn-1',
  provider: 'linear',
  externalAccountId: 'workspace-9',
  scopes: 'read,write',
  status: 'active',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
}

beforeEach(() => {
  fetchCalls = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('listConnections', () => {
  it('parses the connection rows', async () => {
    answerWith(json([connection]))

    const connections = await listConnections()

    expect(fetchCalls[0]?.url).toBe('/v1/factory/connections')
    expect(connections).toEqual([connection])
    expect(connections[0]?.provider).toBe('linear')
  })

  it('propagates a 401 with the server message and status', async () => {
    answerWith(json({ message: 'not signed in' }, 401))

    const failure = await listConnections().catch((thrown: unknown) => thrown)

    expect(failure).toBeInstanceOf(FactoryApiError)
    expect((failure as FactoryApiError).message).toBe('not signed in')
    expect((failure as FactoryApiError).status).toBe(401)
  })

  it('propagates a 400 for a missing active organization', async () => {
    answerWith(json({}, 400))

    const failure = await listConnections().catch((thrown: unknown) => thrown)

    expect(failure).toBeInstanceOf(FactoryApiError)
    expect((failure as FactoryApiError).message).toBe('Could not load connections')
    expect((failure as FactoryApiError).status).toBe(400)
  })

  it('turns a network failure into an unreachable error', async () => {
    globalThis.fetch = (async (): Promise<Response> => {
      throw new TypeError('fetch failed')
    }) as typeof fetch

    const failure = await listConnections().catch((thrown: unknown) => thrown)

    expect(failure).toBeInstanceOf(FactoryApiError)
    expect((failure as Error).message).toBe(UNREACHABLE)
    expect((failure as FactoryApiError).status).toBeNull()
  })
})

describe('listWorkItems', () => {
  it('passes the limit as a query parameter', async () => {
    answerWith(json([]))

    await listWorkItems({ limit: 50 })

    expect(fetchCalls[0]?.url).toBe('/v1/factory/work-items?limit=50')
  })
})

describe('getFactorySettings', () => {
  it('returns the model and vercel shape', async () => {
    answerWith(
      json({
        model: {
          provider: 'inference',
          modelRef: 'inference/kimi-k3-fast',
          source: 'organization',
          hasApiKey: true,
        },
        vercel: { connected: false },
      }),
    )

    const settings = await getFactorySettings()

    expect(fetchCalls[0]?.url).toBe('/v1/factory/settings')
    expect(settings.model.source).toBe('organization')
    expect(settings.model.hasApiKey).toBe(true)
    expect(settings.vercel.connected).toBe(false)
  })
})

describe('saveModelSettings', () => {
  it('puts the api key and model ref', async () => {
    answerWith(json({ ok: true }))

    await saveModelSettings({ apiKey: 'sk-test', modelRef: 'inference/kimi-k3-fast' })

    expect(fetchCalls[0]?.url).toBe('/v1/factory/settings/model')
    expect(fetchCalls[0]?.init?.method).toBe('PUT')
    expect(fetchCalls[0]?.init?.body).toBe(
      JSON.stringify({ apiKey: 'sk-test', modelRef: 'inference/kimi-k3-fast' }),
    )
  })

  it('raises on a rejected save', async () => {
    answerWith(json({ message: 'model ref is required' }, 422))

    await expect(
      saveModelSettings({ apiKey: 'sk-test', modelRef: '' }),
    ).rejects.toMatchObject({ message: 'model ref is required', status: 422 })
  })
})

describe('saveVercelSettings', () => {
  it('puts the token', async () => {
    answerWith(json({ ok: true }))

    await saveVercelSettings({ token: 'vercel-token-1' })

    expect(fetchCalls[0]?.url).toBe('/v1/factory/settings/vercel')
    expect(fetchCalls[0]?.init?.method).toBe('PUT')
    expect(fetchCalls[0]?.init?.body).toBe(JSON.stringify({ token: 'vercel-token-1' }))
  })
})

describe('saveDecisionsSettings', () => {
  it('puts the url and omits an absent token', async () => {
    answerWith(json({ ok: true }))

    await saveDecisionsSettings({ url: 'https://api.typesafe.ai/v1/systemone' })

    expect(fetchCalls[0]?.url).toBe('/v1/factory/settings/decisions')
    expect(fetchCalls[0]?.init?.method).toBe('PUT')
    expect(fetchCalls[0]?.init?.body).toBe(
      JSON.stringify({ url: 'https://api.typesafe.ai/v1/systemone' }),
    )
  })

  it('puts the token when one is given', async () => {
    answerWith(json({ ok: true }))

    await saveDecisionsSettings({ url: 'https://api.typesafe.ai/v1/systemone', token: 'jev-key' })

    expect(fetchCalls[0]?.init?.body).toBe(
      JSON.stringify({ url: 'https://api.typesafe.ai/v1/systemone', token: 'jev-key' }),
    )
  })
})
