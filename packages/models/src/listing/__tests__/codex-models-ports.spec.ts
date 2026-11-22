import { describe, expect, it } from 'bun:test'

import {
  EAuthKind,
  EAuthProvider,
  toAccountId,
  type Credential,
  type OauthCredential,
} from '@dltech/atlas-core'

import { CodexModelsCatalogue } from '../codex-models-catalogue'
import type { CodexModelsPorts } from '../codex-ports'

const NOW = '2026-10-01T12:00:00.000Z'

const credential: OauthCredential = {
  kind: EAuthKind.Oauth,
  accountId: toAccountId('acc_1'),
  accessToken: 'tok-1',
  expiresAt: '2099-01-01T00:00:00.000Z',
  providerAccountId: 'chatgpt-acct-1',
}

const identityOf = (value: OauthCredential): string => `id:${value.providerAccountId}`

const fresh = JSON.stringify({
  identity: identityOf(credential),
  fetchedAt: NOW,
  cards: [
    {
      ref: { providerId: 'openai', modelId: 'seeded' },
      label: 'seeded',
      api: 'openai-responses',
      contextWindow: 1,
      imageTier: 'standard',
    },
  ],
})

const catalogueOver = (args: {
  cache: CodexModelsPorts['cache']
  fetch?: CodexModelsPorts['fetch']
  identityOf?: CodexModelsPorts['identityOf']
}) =>
  new CodexModelsCatalogue({
    credentials: {
      read: async (): Promise<Credential> => credential,
      discard: async () => {},
    },
    provider: EAuthProvider.OpenAI,
    clientVersion: '1.0.0',
    ports: {
      fetch:
        args.fetch ??
        (async () => {
          throw new Error('unexpected fetch')
        }),
      cache: args.cache,
      now: () => NOW,
      identityOf: args.identityOf ?? identityOf,
    },
  })

describe('codex models ports', () => {
  it('reads a synchronous cache without awaiting, so cards() and readCached() stay sync', () => {
    const catalogue = catalogueOver({ cache: { read: () => fresh, write: () => {} } })

    expect(catalogue.readCached()?.map((card) => card.ref.modelId)).toEqual(['seeded'])
    expect(catalogue.cards()?.map((card) => card.ref.modelId)).toEqual(['seeded'])
  })

  it('answers nothing synchronously from an asynchronous cache, then seeds on the first refresh', async () => {
    const catalogue = catalogueOver({ cache: { read: async () => fresh, write: async () => {} } })
    let heard = 0
    catalogue.subscribe(() => (heard += 1))

    expect(catalogue.cards()).toBeUndefined()

    await catalogue.refresh()

    expect(catalogue.cards()?.map((card) => card.ref.modelId)).toEqual(['seeded'])
    expect(catalogue.version()).toBe(1)
    expect(heard).toBe(1)
  })

  it('serves the async-seeded cards without fetching while the entry is fresh', async () => {
    let fetched = 0
    const catalogue = catalogueOver({
      cache: { read: async () => fresh, write: async () => {} },
      fetch: async () => {
        fetched += 1
        return new Response(null, { status: 500 })
      },
    })

    await catalogue.refresh()

    expect(fetched).toBe(0)
    expect(catalogue.lastError()).toBeUndefined()
  })

  it('awaits an asynchronous identity port', async () => {
    const seen: string[] = []
    const catalogue = catalogueOver({
      cache: { read: () => fresh, write: () => {} },
      identityOf: async (value) => {
        seen.push(identityOf(value))
        return identityOf(value)
      },
    })

    await catalogue.refresh()

    expect(seen).toEqual(['id:chatgpt-acct-1'])
    expect(catalogue.lastError()).toBeUndefined()
  })

  it('writes the serialised entry through the cache port after a 200', async () => {
    const written: string[] = []
    const catalogue = catalogueOver({
      cache: { read: () => undefined, write: (text) => void written.push(text) },
      fetch: async () =>
        new Response(JSON.stringify({ models: [{ slug: 'a', visibility: 'list', priority: 1 }] }), {
          headers: { etag: '"v1"' },
        }),
    })

    await catalogue.refresh()

    expect(written).toHaveLength(1)
    expect(JSON.parse(written[0] ?? '')).toMatchObject({
      identity: 'id:chatgpt-acct-1',
      fetchedAt: NOW,
      etag: '"v1"',
    })
  })

  it('keeps serving and does not throw when the cache port cannot write', async () => {
    const catalogue = catalogueOver({
      cache: {
        read: () => undefined,
        write: async () => {
          throw new Error('disk full')
        },
      },
      fetch: async () =>
        new Response(JSON.stringify({ models: [{ slug: 'a', visibility: 'list', priority: 1 }] })),
    })

    await catalogue.refresh()

    expect(catalogue.cards()?.map((card) => card.ref.modelId)).toEqual(['a'])
    expect(catalogue.lastError()).toBeUndefined()
  })

  it('treats a throwing cache read as an empty cache', async () => {
    const catalogue = catalogueOver({
      cache: {
        read: () => {
          throw new Error('unreadable')
        },
        write: () => {},
      },
      fetch: async () =>
        new Response(JSON.stringify({ models: [{ slug: 'a', visibility: 'list', priority: 1 }] })),
    })

    expect(catalogue.readCached()).toBeUndefined()
    await catalogue.refresh()
    expect(catalogue.cards()?.map((card) => card.ref.modelId)).toEqual(['a'])
  })
})
