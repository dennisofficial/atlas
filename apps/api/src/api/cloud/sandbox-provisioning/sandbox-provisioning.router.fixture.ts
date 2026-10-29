import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Provider } from '@nestjs/common'
import request from 'supertest'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  as,
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'

const USERS: Record<string, string> = { 'session-a': 'usr-1', 'session-b': 'usr-2' }

export const fakeSessionVerifier = {
  async verify(req: { headers: { authorization?: string | undefined } }) {
    const token = (req.headers.authorization ?? '').replace('Bearer ', '')
    const userId = USERS[token]
    if (userId === undefined) return null
    return { userId, sessionId: 'ses', email: '' }
  },
}

export const createRouterApp = (providers: Provider[]): Promise<NestExpressApplication> =>
  createMiddlewareApp({
    rateLimit: UNTHROTTLED_RATE_LIMIT,
    providers: [
      ...providers,
      SessionMiddleware,
      { provide: SESSION_VERIFIER, useValue: fakeSessionVerifier },
    ],
  })

const authed = <T extends request.Test>(call: T, token: string | undefined): T =>
  token === undefined ? call : (call.set(as(token)) as T)

export const callQuery = ({
  app,
  procedure,
  input,
  token,
}: {
  app: NestExpressApplication
  procedure: string
  input: unknown
  token?: string
}) =>
  authed(
    request(app.getHttpServer()).get(
      `/v1/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`,
    ),
    token,
  )

export const callMutation = ({
  app,
  procedure,
  input,
  token,
}: {
  app: NestExpressApplication
  procedure: string
  input: unknown
  token?: string
}) =>
  authed(request(app.getHttpServer()).post(`/v1/trpc/${procedure}`), token).send(input as object)
