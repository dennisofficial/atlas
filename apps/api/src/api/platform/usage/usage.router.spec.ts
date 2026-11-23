import { EAccountOrigin, EAccountStatus, EAuthKind, EAuthProvider } from '@dltech/atlas-core'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  as,
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { USAGE } from '../../../agent'
import type { UsageAccountRow, UsageAccounts } from '../../../agent'
import { UsageService } from '../../../agent'
import { UsageRouter } from './usage.router'

const USERS: Record<string, string> = { 'token-a': 'user-a', 'token-b': 'user-b' }
const ACCOUNT = 'acc-1'
const TOKEN = 'plan-access-token-1'
const NOW = Date.parse('2026-11-23T12:00:00.000Z')

const ROW: UsageAccountRow = {
  id: ACCOUNT,
  userId: 'user-a',
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
  sealedSecret: JSON.stringify({
    kind: EAuthKind.Oauth,
    tokens: {
      accessToken: TOKEN,
      refreshToken: 'refresh-token-1',
      expiresAt: '2026-11-24T00:00:00.000Z',
    },
    authority: { url: 'https://example.test', connectionId: 'conn-1' },
  }),
}

const accountsOf = (rows: readonly UsageAccountRow[]): UsageAccounts => ({
  async owned({ userId, accountId }) {
    return rows.find((row) => row.userId === userId && row.id === accountId) ?? null
  },
  async chosen({ userId, provider }) {
    return rows.find((row) => row.userId === userId && row.provider === provider) ?? null
  },
  async sessionOwner() {
    return null
  },
})

const usageOf = (): UsageService =>
  new UsageService({
    accounts: accountsOf([ROW]),
    now: () => NOW,
    cipher: { decrypt: (sealed) => sealed },
    clientVersions: { anthropic: '2.1.296', codex: '0.171.0' },
    fetch: (async () =>
      new Response(
        JSON.stringify({ five_hour: { utilization: 68, resets_at: '2026-11-23T16:00:00.000Z' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof globalThis.fetch,
    tokens: {
      async issue() {
        return {
          accessToken: TOKEN,
          expiresAt: '2026-11-24T00:00:00.000Z',
          refreshAfter: '2026-11-23T13:00:00.000Z',
          generation: 1,
        }
      },
    },
  })

describe('UsageRouter', () => {
  let app: INestApplication
  const url = '/v1/trpc/usage.report'
  const query = (token: string | undefined, input: unknown) => {
    const call = request(app.getHttpServer()).get(url)
    const authed = token === undefined ? call : call.set(as(token))
    return authed.query({ input: JSON.stringify(input) })
  }

  beforeAll(async () => {
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      providers: [
        UsageRouter,
        { provide: USAGE, useValue: usageOf() },
        SessionMiddleware,
        {
          provide: SESSION_VERIFIER,
          useValue: {
            async verify(req: { headers: { authorization?: string } }) {
              const userId = USERS[(req.headers.authorization ?? '').replace(/^Bearer /, '')]
              if (userId === undefined) return null
              return { userId, sessionId: 's', email: '' }
            },
          },
        },
      ],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('answers 401 without a session', async () => {
    const answer = await query(undefined, { accountId: ACCOUNT })

    expect(answer.status).toBe(401)
  })

  it("answers the caller's own account", async () => {
    const answer = await query('token-a', { accountId: ACCOUNT })

    expect(answer.status).toBe(200)
    expect(answer.body.result.data).toEqual({
      accountId: ACCOUNT,
      label: 'dennis@byatlas.io',
      metered: true,
      fiveHour: { utilization: 68, resetsAt: '2026-11-23T16:00:00.000Z' },
      sevenDay: null,
      fetchedAt: new Date(NOW).toISOString(),
    })
    expect(JSON.stringify(answer.body)).not.toContain(TOKEN)
  })

  it("answers 404 for another user's account", async () => {
    const answer = await query('token-b', { accountId: ACCOUNT })

    expect(answer.status).toBe(404)
  })

  it('answers unmetered when the provider has no account', async () => {
    const answer = await query('token-a', { provider: EAuthProvider.Gateway })

    expect(answer.status).toBe(200)
    expect(answer.body.result.data).toEqual({
      accountId: null,
      label: null,
      metered: false,
      fiveHour: null,
      sevenDay: null,
      fetchedAt: null,
    })
  })
})
