import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  EAuthKind,
  EAuthProvider,
  toAccountId,
  type Credential,
  type OauthCredential,
} from '@dltech/atlas-core'

import { CODEX_VERSION } from '../../providers/codex-version'
import { CodexModelsCatalogue, codexCacheIdentity } from '../codex-models-catalogue'

const T0 = Date.parse('2026-10-01T12:00:00.000Z')
const TTL = 300_000

let directory: string
let cacheFile: string
let clock: number

const oauthFixture = (): OauthCredential => ({
  kind: EAuthKind.Oauth,
  accountId: toAccountId('acc_1'),
  accessToken: 'tok-1',
  expiresAt: '2099-01-01T00:00:00.000Z',
})

const oauth = (providerAccountId = 'chatgpt-acct-1'): Credential => ({
  ...oauthFixture(),
  providerAccountId,
})

const listed = (slug: string, priority = 1) => ({ slug, visibility: 'list', priority })

const jsonResponse = (args: { models: unknown[]; etag?: string; status?: number }) =>
  new Response(JSON.stringify({ models: args.models }), {
    status: args.status ?? 200,
    headers: args.etag === undefined ? {} : { etag: args.etag },
  })

const recordingFetch = (replies: (() => Response)[]) => {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } })
    const reply = replies.shift()
    if (reply === undefined) throw new Error('unexpected fetch')
    return reply()
  }
  return { calls, fetch }
}

const catalogueWith = (args: {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  credential?: Credential
}) =>
  new CodexModelsCatalogue({
    credentials: { read: async () => args.credential ?? oauth(), discard: async () => {} },
    provider: EAuthProvider.OpenAI,
    clientVersion: CODEX_VERSION,
    fetch: args.fetch,
    cacheFile,
    ttlMs: TTL,
    now: () => new Date(clock).toISOString(),
  })

const idle = () => catalogueWith({ fetch: recordingFetch([]).fetch })

const seedCache = (entry: unknown) => writeFile(cacheFile, JSON.stringify(entry))

const cardRow = (modelId: string) => ({
  ref: { providerId: 'openai', modelId },
  label: modelId,
  api: 'openai-responses',
  contextWindow: 1,
  imageTier: 'standard',
})

const modelIds = (catalogue: CodexModelsCatalogue) => catalogue.cards()?.map((c) => c.ref.modelId)

const identityOf = (providerAccountId: string) =>
  codexCacheIdentity({ ...oauthFixture(), providerAccountId })

const seedStale = (modelId: string, etag?: string) =>
  seedCache({
    identity: identityOf('chatgpt-acct-1'),
    fetchedAt: new Date(T0 - TTL * 2).toISOString(),
    ...(etag === undefined ? {} : { etag }),
    cards: [cardRow(modelId)],
  })

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atlas-codex-models-'))
  cacheFile = join(directory, 'codex-models-cache.json')
  clock = T0
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('readCached', () => {
  const entry = (fetchedAt: number) => ({
    identity: identityOf('chatgpt-acct-1'),
    fetchedAt: new Date(fetchedAt).toISOString(),
    cards: [cardRow('gpt-x')],
  })

  const unreadable: [string, () => Promise<void>][] = [
    ['there is no file', async () => {}],
    ['the JSON is corrupt', () => writeFile(cacheFile, '{not json')],
    ['the file is schema-invalid', () => seedCache({ identity: 1, cards: 'nope' })],
    ['the TTL has elapsed', () => seedCache(entry(T0 - TTL))],
  ]

  for (const [reason, arrange] of unreadable) {
    it(`answers nothing when ${reason}`, async () => {
      await arrange()
      expect(idle().readCached()).toBeUndefined()
    })
  }

  it('answers the cards while within the TTL', async () => {
    await seedCache(entry(T0 - TTL + 1))
    const cached = idle().readCached()
    expect(cached?.map((c) => c.ref.modelId)).toEqual(['gpt-x'])
  })

  it('still seeds cards() from an expired file so the picker is right offline', async () => {
    await seedCache(entry(T0 - TTL * 10))
    const cards = idle().cards()
    expect(cards?.map((c) => c.ref.modelId)).toEqual(['gpt-x'])
  })
})

describe('refresh', () => {
  it('requests the models URL with the codex headers', async () => {
    const { calls, fetch } = recordingFetch([() => jsonResponse({ models: [listed('a')] })])

    await catalogueWith({ fetch }).refresh()

    expect(calls).toEqual([
      {
        url: `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_VERSION}`,
        headers: {
          Authorization: 'Bearer tok-1',
          'ChatGPT-Account-ID': 'chatgpt-acct-1',
          originator: 'codex_cli_rs',
        },
      },
    ])
  })

  it('sends If-None-Match when an etag is cached', async () => {
    await seedStale('old', '"v1"')
    const { calls, fetch } = recordingFetch([() => new Response(null, { status: 304 })])

    await catalogueWith({ fetch }).refresh()

    expect(calls[0]?.headers['If-None-Match']).toBe('"v1"')
  })

  it('persists, serves, bumps the version and notifies on a 200 with listed models', async () => {
    const models = [listed('b', 2), listed('a', 1)]
    const { fetch } = recordingFetch([() => jsonResponse({ models, etag: '"v2"' })])
    const catalogue = catalogueWith({ fetch })
    let heard = 0
    catalogue.subscribe(() => (heard += 1))
    await catalogue.refresh()

    expect(modelIds(catalogue)).toEqual(['a', 'b'])
    expect(catalogue.version()).toBe(1)
    expect(heard).toBe(1)
    const onDisk = JSON.parse(await readFile(cacheFile, 'utf8'))
    expect(onDisk).toMatchObject({
      identity: identityOf('chatgpt-acct-1'),
      fetchedAt: new Date(T0).toISOString(),
      etag: '"v2"',
    })
    expect(idle().readCached()).toHaveLength(2)
  })

  it('does not fetch again while the cache is fresh', async () => {
    const { calls, fetch } = recordingFetch([() => jsonResponse({ models: [listed('a')] })])
    const catalogue = catalogueWith({ fetch })
    await catalogue.refresh()
    clock = T0 + TTL - 1
    await catalogue.refresh()
    expect(calls).toHaveLength(1)
  })

  it('keeps the cards on a 304, re-stamps fetchedAt and does not bump the version', async () => {
    const stale = () => new Response(null, { status: 304 })
    const { fetch } = recordingFetch([() => jsonResponse({ models: [listed('a')], etag: '"v1"' }), stale])
    const catalogue = catalogueWith({ fetch })
    await catalogue.refresh()
    clock = T0 + TTL * 2

    await catalogue.refresh()

    expect(modelIds(catalogue)).toEqual(['a'])
    expect(catalogue.version()).toBe(1)
    const onDisk = JSON.parse(await readFile(cacheFile, 'utf8'))
    expect(onDisk.fetchedAt).toBe(new Date(clock).toISOString())
    expect(onDisk.etag).toBe('"v1"')
  })

  for (const status of [401, 500]) {
    it(`keeps the prior cards and does not throw on a ${status}`, async () => {
      const refused = () => new Response('nope', { status })
      const { fetch } = recordingFetch([() => jsonResponse({ models: [listed('a')] }), refused])
      const catalogue = catalogueWith({ fetch })
      await catalogue.refresh()
      clock = T0 + TTL * 2

      await catalogue.refresh()

      expect(modelIds(catalogue)).toEqual(['a'])
      expect(catalogue.version()).toBe(1)
      expect(catalogue.lastError()).toContain(String(status))
    })
  }

  it('keeps the prior cards and does not throw when the network fails', async () => {
    await seedStale('old')
    const catalogue = catalogueWith({
      fetch: async () => {
        throw new Error('offline')
      },
    })

    await catalogue.refresh()

    expect(modelIds(catalogue)).toEqual(['old'])
    expect(catalogue.lastError()).toBe('offline')
  })

  it('does not replace the cache when the response lists no model', async () => {
    const hidden = { slug: 'z', visibility: 'hide', priority: 1 }
    const replies = [() => jsonResponse({ models: [listed('a')] }), () => jsonResponse({ models: [hidden] })]
    const { fetch } = recordingFetch(replies)
    const catalogue = catalogueWith({ fetch })
    await catalogue.refresh()
    clock = T0 + TTL * 2

    await catalogue.refresh()

    expect(modelIds(catalogue)).toEqual(['a'])
    expect(catalogue.version()).toBe(1)
  })

  it('does nothing for an API-key account', async () => {
    const { calls, fetch } = recordingFetch([])
    const accountId = toAccountId('acc_k')
    const apiKey: Credential = { kind: EAuthKind.ApiKey, accountId, apiKey: 'sk-x' }
    const catalogue = catalogueWith({ fetch, credential: apiKey })

    await catalogue.refresh()

    expect(calls).toHaveLength(0)
    expect(catalogue.cards()).toBeUndefined()
  })
})

describe('identity', () => {
  it('differs per ChatGPT account and falls back to the Atlas account id', () => {
    expect(identityOf('chatgpt-acct-1')).not.toBe(identityOf('chatgpt-acct-2'))
    expect(codexCacheIdentity(oauthFixture())).not.toBe(identityOf('chatgpt-acct-1'))
  })

  it('refetches and swaps cards when the signed-in account changes', async () => {
    await seedStale('mine', '"a"')

    const second = recordingFetch([() => jsonResponse({ models: [listed('theirs')] })])
    const switched = catalogueWith({ fetch: second.fetch, credential: oauth('chatgpt-acct-2') })
    expect(modelIds(switched)).toEqual(['mine'])

    await switched.refresh()

    expect(second.calls).toHaveLength(1)
    expect(second.calls[0]?.headers['If-None-Match']).toBeUndefined()
    expect(modelIds(switched)).toEqual(['theirs'])
  })

  it('drops the previous account list when the new account request fails', async () => {
    await seedStale('mine')
    const switched = catalogueWith({
      fetch: async () => new Response('x', { status: 500 }),
      credential: oauth('chatgpt-acct-2'),
    })

    await switched.refresh()

    expect(switched.cards()).toBeUndefined()
  })
})
