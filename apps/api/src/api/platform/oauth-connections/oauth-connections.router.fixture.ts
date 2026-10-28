import { UnauthorizedException, type Provider } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { EnvService } from '../../../_core/config/env/env.service'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { SandboxesService } from '../sandboxes/sandboxes.service'
import { ETokenPrincipalKind } from '../sandboxes/token-principal'
import { SessionOrSandboxMiddleware } from '../sessions/session-or-sandbox.middleware'
import { FakeClock, FakeIssuer, FakeStore } from './oauth-connections.fakes'
import { OauthConnectionsRouter } from './oauth-connections.router'
import { OauthConnectionsService } from './oauth-connections.service'
import { OauthClock, OauthConnectionStore, OauthIssuer } from './oauth-connections.types'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

export const START = Date.parse('2026-10-05T12:00:00.000Z')

export const SESSIONS: Record<string, string> = { 'session-a': 'user-a', 'session-b': 'user-b' }

export const bearerOf = (req: { headers: { authorization?: string } }): string =>
  (req.headers.authorization ?? '').replace(/^Bearer /i, '')

export const sessionVerifier = (sessions: Record<string, string>) => ({
  async verify(req: { headers: { authorization?: string } }) {
    const userId = sessions[bearerOf(req)]
    if (userId === undefined) return null
    return { userId, sessionId: 'ses', email: '' }
  },
})

export const principalSandboxes = (args: {
  principals: Record<string, unknown>
  assertThreadInFamily?: () => Promise<void>
}) => ({
  async verifyTokenPrincipal(query: { token: string }) {
    const row = args.principals[query.token]
    if (row === undefined) throw new UnauthorizedException()
    return row
  },
  assertThreadInFamily: args.assertThreadInFamily ?? (async () => undefined),
})

export const SANDBOX_PRINCIPALS = {
  'sandbox-token-1': {
    kind: ETokenPrincipalKind.Sandbox,
    id: 'sbx-1',
    threadId: 'thread-1',
    userId: 'user-a',
  },
  'sandbox-token-2': {
    kind: ETokenPrincipalKind.Sandbox,
    id: 'sbx-2',
    threadId: 'thread-2',
    userId: 'user-a',
  },
}

export const oauthProviders = (args: {
  store: FakeStore
  sandboxes: ReturnType<typeof principalSandboxes>
  extra?: Provider[]
}): Provider[] => [
  OauthConnectionsRouter,
  OauthConnectionsService,
  SessionMiddleware,
  SessionOrSandboxMiddleware,
  { provide: OauthConnectionStore, useValue: args.store },
  { provide: OauthIssuer, useValue: new FakeIssuer() },
  { provide: OauthClock, useValue: new FakeClock(START) },
  {
    provide: SecretCipherService,
    useValue: new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY })),
  },
  { provide: SESSION_VERIFIER, useValue: sessionVerifier(SESSIONS) },
  { provide: SandboxesService, useValue: args.sandboxes },
  ...(args.extra ?? []),
]

export const createOauthApp = (providers: Provider[]): Promise<NestExpressApplication> =>
  createMiddlewareApp({ providers, rateLimit: UNTHROTTLED_RATE_LIMIT })

export const procedureUrl = (procedure: string): string => `/v1/trpc/${procedure}`

export const mutate = (args: {
  app: NestExpressApplication
  procedure: string
  token?: string | undefined
  body?: object | undefined
}) => {
  const call = request(args.app.getHttpServer()).post(procedureUrl(args.procedure))
  const authed =
    args.token === undefined ? call : call.set({ authorization: `Bearer ${args.token}` })
  return args.body === undefined ? authed : authed.send(args.body)
}

export const query = (args: {
  app: NestExpressApplication
  procedure: string
  token?: string | undefined
  input?: object | undefined
}) => {
  const call = request(args.app.getHttpServer()).get(procedureUrl(args.procedure))
  const withInput =
    args.input === undefined ? call : call.query({ input: JSON.stringify(args.input) })
  return args.token === undefined
    ? withInput
    : withInput.set({ authorization: `Bearer ${args.token}` })
}
