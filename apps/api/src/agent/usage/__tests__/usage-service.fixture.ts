import { EAccountOrigin, EAccountStatus, EAuthKind, EAuthProvider } from '@dltech/atlas-core'

import type { UsageAccountRow, UsageAccounts, UsageSessionOwner } from '../usage-accounts'
import { UsageService } from '../usage-service'

export const USER = 'user-a'
export const OTHER = 'user-b'
export const ACCOUNT = 'acc-1'
export const NOW = Date.parse('2026-11-23T12:00:00.000Z')
export const TOKEN = 'plan-access-token-1'

export const anthropicBody = {
  five_hour: { utilization: 42, resets_at: '2026-11-23T15:00:00.000Z' },
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export const oauthSecret = (provider: EAuthProvider): string =>
  JSON.stringify({
    kind: EAuthKind.Oauth,
    tokens: {
      accessToken: TOKEN,
      refreshToken: 'refresh-token-1',
      expiresAt: '2026-11-24T00:00:00.000Z',
    },
    authority: { url: 'https://example.test', connectionId: `conn-${provider}` },
  })

export const rowOf = (over: Partial<UsageAccountRow> = {}): UsageAccountRow => ({
  id: ACCOUNT,
  userId: USER,
  provider: EAuthProvider.Anthropic,
  kind: EAuthKind.Oauth,
  origin: EAccountOrigin.Login,
  label: 'work',
  status: EAccountStatus.Active,
  email: 'dennis@byatlas.io',
  subscription: null,
  importedFrom: null,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  sealedSecret: oauthSecret(EAuthProvider.Anthropic),
  ...over,
})

export type Call = { url: string; headers: Record<string, string> }

const scripted = (
  answer: (call: Call) => Response,
): { calls: Call[]; fetch: typeof globalThis.fetch } => {
  const calls: Call[] = []
  const fetch = async (...args: Parameters<typeof globalThis.fetch>): Promise<Response> => {
    const [input, init] = args
    const call = {
      url: String(input),
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
    }
    calls.push(call)
    return answer(call)
  }
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch }
}

export type Harness = {
  service: UsageService
  calls: Call[]
  issued: { userId: string; connectionId: string }[]
}

export const harnessOf = (args: {
  rows?: UsageAccountRow[]
  owners?: Record<string, UsageSessionOwner>
  answer?: (call: Call) => Response
  issue?: () => Promise<never>
  now?: () => number
}): Harness => {
  const rows = args.rows ?? [rowOf()]
  const { calls, fetch } = scripted(args.answer ?? (() => json(anthropicBody)))
  const issued: { userId: string; connectionId: string }[] = []
  const accounts: UsageAccounts = {
    async owned({ userId, accountId }) {
      return rows.find((row) => row.userId === userId && row.id === accountId) ?? null
    },
    async chosen({ userId, provider }) {
      return rows.find((row) => row.userId === userId && row.provider === provider) ?? null
    },
    async sessionOwner({ sessionId }) {
      return args.owners?.[sessionId] ?? null
    },
  }
  const service = new UsageService({
    accounts,
    fetch,
    now: args.now ?? (() => NOW),
    cipher: { decrypt: (sealed) => sealed },
    clientVersions: { anthropic: '2.1.296', codex: '0.171.0' },
    tokens: {
      async issue(request) {
        issued.push(request)
        if (args.issue !== undefined) return args.issue()
        return {
          accessToken: TOKEN,
          expiresAt: '2026-11-24T00:00:00.000Z',
          refreshAfter: '2026-11-23T13:00:00.000Z',
          generation: 1,
          providerAccountId: 'provider-account-1',
        }
      },
    },
  })
  return { service, calls, issued }
}
