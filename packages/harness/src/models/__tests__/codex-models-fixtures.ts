import {
  EAuthKind,
  EAuthProvider,
  toAccountId,
  type Credential,
  type OauthCredential,
} from '@dltech/atlas-core'

import { CodexModelsCatalogue } from '../codex-models-catalogue'
import type { CodexModelsPorts } from '../codex-ports'
import { CODEX_VERSION } from '../codex-version'

export { CODEX_VERSION }

export const T0 = Date.parse('2026-10-01T12:00:00.000Z')
export const TTL = 300_000

export const clock = { at: 0 }
export const store: { text: string | undefined } = { text: undefined }

export const codexCacheIdentity = (credential: OauthCredential): string =>
  `identity:${credential.providerAccountId ?? credential.accountId}`

const memoryCache = (): CodexModelsPorts['cache'] => ({
  read: () => store.text,
  write: (text) => {
    store.text = text
  },
})

export const oauthFixture = (): OauthCredential => ({
  kind: EAuthKind.Oauth,
  accountId: toAccountId('acc_1'),
  accessToken: 'tok-1',
  expiresAt: '2099-01-01T00:00:00.000Z',
})

export const oauth = (providerAccountId = 'chatgpt-acct-1'): Credential => ({
  ...oauthFixture(),
  providerAccountId,
})

export const listed = (slug: string, priority = 1) => ({ slug, visibility: 'list', priority })

export const jsonResponse = (args: { models: unknown[]; etag?: string; status?: number }) =>
  new Response(JSON.stringify({ models: args.models }), {
    status: args.status ?? 200,
    headers: args.etag === undefined ? {} : { etag: args.etag },
  })

export const recordingFetch = (replies: (() => Response)[]) => {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } })
    const reply = replies.shift()
    if (reply === undefined) throw new Error('unexpected fetch')
    return reply()
  }
  return { calls, fetch }
}

export const catalogueWith = (args: {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  credential?: Credential
  cache?: CodexModelsPorts['cache']
}) =>
  new CodexModelsCatalogue({
    credentials: { read: async () => args.credential ?? oauth(), discard: async () => {} },
    provider: EAuthProvider.OpenAI,
    clientVersion: CODEX_VERSION,
    ports: {
      fetch: args.fetch,
      cache: args.cache ?? memoryCache(),
      now: () => new Date(clock.at).toISOString(),
      identityOf: codexCacheIdentity,
    },
    ttlMs: TTL,
  })

export const idle = () => catalogueWith({ fetch: recordingFetch([]).fetch })

export const seedCache = async (entry: unknown) => {
  store.text = JSON.stringify(entry)
}

export const cardRow = (modelId: string) => ({
  ref: { providerId: 'openai', modelId },
  label: modelId,
  api: 'openai-responses',
  contextWindow: 1,
  imageTier: 'standard',
})

export const modelIds = (catalogue: CodexModelsCatalogue) =>
  catalogue.cards()?.map((c) => c.ref.modelId)

export const identityOf = (providerAccountId: string) =>
  codexCacheIdentity({ ...oauthFixture(), providerAccountId })

export const seedStale = (modelId: string, etag?: string) =>
  seedCache({
    identity: identityOf('chatgpt-acct-1'),
    fetchedAt: new Date(T0 - TTL * 2).toISOString(),
    ...(etag === undefined ? {} : { etag }),
    cards: [cardRow(modelId)],
  })
