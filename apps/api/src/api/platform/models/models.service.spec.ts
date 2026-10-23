import { beforeEach, describe, expect, it } from 'bun:test'
import { EModelProviderStatus } from '@dltech/atlas-wire/web'
import { CodexCacheRegistry } from './api-codex-ports'
import { account, accountsOf, codexReply, oauthFake, recordingFetch } from './models.fakes'
import { ModelsService } from './models.service'

const T0 = Date.parse('2026-10-01T12:00:00.000Z')
const TTL = 300_000

let clock: number
let caches: CodexCacheRegistry

const serviceWith = (args: {
  accounts: Parameters<typeof accountsOf>[0]
  connections?: Record<string, string>
  fetch?: ReturnType<typeof recordingFetch>
}) => {
  const oauth = oauthFake(args.connections ?? {})
  const http = args.fetch ?? recordingFetch([])
  const service = new ModelsService(accountsOf(args.accounts), oauth, caches, http.fetch, () =>
    new Date(clock).toISOString(),
  )
  return { service, oauth, http }
}

const openAi = (response: Awaited<ReturnType<ModelsService['list']>>) =>
  response.providers.find((provider) => provider.id === 'openai')

beforeEach(() => {
  clock = T0
  caches = new CodexCacheRegistry()
})

describe('ModelsService', () => {
  it('lists no providers for a user with no accounts', async () => {
    const { service } = serviceWith({ accounts: {} })
    expect(await service.list({ userId: 'u1' })).toEqual({ providers: [] })
  })

  it('lists an expired-only provider as expired with no models', async () => {
    const { service } = serviceWith({
      accounts: { u1: [account({ provider: 'anthropic', status: 'expired' })] },
    })

    expect(await service.list({ userId: 'u1' })).toEqual({
      providers: [
        {
          id: 'anthropic',
          label: 'Claude Plan',
          status: EModelProviderStatus.Expired,
          live: false,
          models: [],
        },
      ],
    })
  })

  it('serves the static OpenAI list for an API key without any network call', async () => {
    const { service, http, oauth } = serviceWith({
      accounts: { u1: [account({ provider: 'openai', kind: 'api-key' })] },
      connections: { u1: 'conn-1' },
    })

    const provider = openAi(await service.list({ userId: 'u1' }))

    expect(provider?.live).toBe(false)
    expect(provider?.models.length).toBeGreaterThan(1)
    expect(http.calls).toHaveLength(0)
    expect(oauth.issued).toEqual([])
  })

  it('replaces the static list with the live Codex list for an active OAuth connection', async () => {
    const http = recordingFetch([() => codexReply({ slugs: ['gpt-live'], etag: '"v1"' })])
    const { service } = serviceWith({
      accounts: { u1: [account({ provider: 'openai' })] },
      connections: { u1: 'conn-1' },
      fetch: http,
    })

    const response = await service.list({ userId: 'u1' })

    expect(openAi(response)).toMatchObject({
      live: true,
      models: [{ id: 'openai/gpt-live' }],
    })
    expect(response.liveError).toBeUndefined()
    expect(http.calls).toHaveLength(1)
    expect(http.calls[0]?.headers).toMatchObject({
      Authorization: 'Bearer tok-u1',
      'ChatGPT-Account-ID': 'chatgpt-u1',
    })
  })

  it('answers a second request within 300 s from the cache', async () => {
    const http = recordingFetch([() => codexReply({ slugs: ['gpt-live'] })])
    const { service } = serviceWith({
      accounts: { u1: [account({ provider: 'openai' })] },
      connections: { u1: 'conn-1' },
      fetch: http,
    })
    await service.list({ userId: 'u1' })
    clock = T0 + TTL - 1

    const again = await service.list({ userId: 'u1' })

    expect(http.calls).toHaveLength(1)
    expect(openAi(again)?.models.map((model) => model.id)).toEqual(['openai/gpt-live'])
  })

  it('revalidates a stale entry with If-None-Match and keeps the cards on a 304', async () => {
    const http = recordingFetch([
      () => codexReply({ slugs: ['gpt-live'], etag: '"v1"' }),
      () => new Response(null, { status: 304 }),
    ])
    const { service } = serviceWith({
      accounts: { u1: [account({ provider: 'openai' })] },
      connections: { u1: 'conn-1' },
      fetch: http,
    })
    await service.list({ userId: 'u1' })
    clock = T0 + TTL * 2

    const again = await service.list({ userId: 'u1' })

    expect(http.calls[1]?.headers['If-None-Match']).toBe('"v1"')
    expect(openAi(again)).toMatchObject({ live: true, models: [{ id: 'openai/gpt-live' }] })
  })

  it('falls back to the static list with liveError when Codex answers 500', async () => {
    const http = recordingFetch([() => new Response('boom', { status: 500 })])
    const { service } = serviceWith({
      accounts: { u1: [account({ provider: 'openai' })] },
      connections: { u1: 'conn-1' },
      fetch: http,
    })

    const response = await service.list({ userId: 'u1' })

    expect(openAi(response)?.live).toBe(false)
    expect(openAi(response)?.models.length).toBeGreaterThan(1)
    expect(response.liveError).toContain('500')
  })

  it('never reads another user’s connection or serves another user’s cache', async () => {
    const http = recordingFetch([() => codexReply({ slugs: ['gpt-live'] })])
    const { service, oauth } = serviceWith({
      accounts: {
        u1: [account({ provider: 'openai' })],
        u2: [account({ provider: 'openai' })],
      },
      connections: { u1: 'conn-1' },
      fetch: http,
    })
    await service.list({ userId: 'u1' })

    const other = await service.list({ userId: 'u2' })

    expect(oauth.lookedUp).toEqual(['u1', 'u2'])
    expect(oauth.issued).toEqual(['u1:conn-1'])
    expect(openAi(other)?.live).toBe(false)
    expect(http.calls).toHaveLength(1)
  })

  it('serves no live list when the OAuth account has no active connection', async () => {
    const { service, http } = serviceWith({ accounts: { u1: [account({ provider: 'openai' })] } })

    const response = await service.list({ userId: 'u1' })

    expect(openAi(response)?.live).toBe(false)
    expect(http.calls).toHaveLength(0)
  })
})
