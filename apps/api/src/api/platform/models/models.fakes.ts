import type { AccountDto } from '@dltech/atlas-wire'
import type { ModelsOauth, ModelsAccounts } from './models.service'

export const account = (args: {
  provider: string
  kind?: string
  status?: string
  id?: string
}): AccountDto => ({
  id: args.id ?? `acc_${args.provider}_${args.kind ?? 'oauth'}`,
  provider: args.provider,
  kind: args.kind ?? 'oauth',
  origin: 'login',
  label: args.provider,
  status: args.status ?? 'active',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
})

export const accountsOf = (byUser: Record<string, AccountDto[]>): ModelsAccounts => ({
  list: async ({ userId }) => byUser[userId] ?? [],
})

export type OauthFake = ModelsOauth & { lookedUp: string[]; issued: string[] }

export const oauthFake = (connections: Record<string, string>): OauthFake => {
  const fake: OauthFake = {
    lookedUp: [],
    issued: [],
    activeConnection: async ({ userId }) => {
      fake.lookedUp.push(userId)
      const connectionId = connections[userId]
      return connectionId === undefined ? null : { connectionId }
    },
    issueAccessToken: async ({ userId, connectionId }) => {
      fake.issued.push(`${userId}:${connectionId}`)
      return {
        accessToken: `tok-${userId}`,
        expiresAt: '2099-01-01T00:00:00.000Z',
        refreshAfter: '2099-01-01T00:00:00.000Z',
        generation: 0,
        authorizationId: connectionId,
        providerAccountId: `chatgpt-${userId}`,
      }
    },
  }
  return fake
}

export const codexReply = (args: { slugs: string[]; etag?: string }) =>
  new Response(
    JSON.stringify({
      models: args.slugs.map((slug, priority) => ({ slug, visibility: 'list', priority })),
    }),
    { headers: args.etag === undefined ? {} : { etag: args.etag } },
  )

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
