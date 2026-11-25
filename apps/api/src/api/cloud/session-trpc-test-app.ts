import { FRESH_SESSION_WINDOW_MS } from '../../_module/session/fresh-session'
import type { INestApplication, Provider } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { ThrottlerModule } from '@nestjs/throttler'
import { TRPCModule } from 'nestjs-trpc'
import request from 'supertest'
import { EnvService } from '../../_core/config/env/env.service'
import { SESSION_VERIFIER } from '../../_core/ports/session-verifier'
import { JSON_BODY_LIMIT } from '../../_lib/body-limits'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import { SessionMiddleware } from '../../_module/session/session.middleware'
import { ApiTrpcContext } from '../../_module/trpc/api-trpc-context'
import { ApiTrpcModule } from '../../_module/trpc/api-trpc.module'
import { HttpErrorMiddleware } from '../../_module/trpc/http-error.middleware'
import { ThrottleMiddleware } from '../../_module/trpc/throttle.middleware'
import { apiErrorFormatter } from '../../_module/trpc/trpc-error-formatter'
import { fakeEnvModule, UNTHROTTLED_RATE_LIMIT } from '../../_module/trpc/trpc-middleware.fixture'
const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

export const testCipher = (): SecretCipherService =>
  new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))

export const STALE_PREFIX = 'stale:'

export const SESSIONS: Record<string, string> = {
  'session-a': 'user-a',
  'session-b': 'user-b',
  'session-c': 'user-c',
}

export async function buildSessionTrpcApp(args: {
  providers: Provider[]
}): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [
      fakeEnvModule(UNTHROTTLED_RATE_LIMIT),
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: UNTHROTTLED_RATE_LIMIT }]),
      ApiTrpcModule,
      TRPCModule.forRoot({
        basePath: '/v1/trpc',
        context: ApiTrpcContext,
        errorFormatter: apiErrorFormatter,
        globalMiddlewares: [HttpErrorMiddleware, ThrottleMiddleware],
      }),
    ],
    providers: [
      ...args.providers,
      SessionMiddleware,
      SessionMiddleware,
      { provide: SecretCipherService, useValue: testCipher() },
      {
        provide: SESSION_VERIFIER,
        useValue: {
          async verify(req: { headers: { authorization?: string } }) {
            const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '')
            const stale = token.startsWith(STALE_PREFIX)
            const userId = SESSIONS[stale ? token.slice(STALE_PREFIX.length) : token]
            if (userId === undefined) return null
            return {
              userId,
              sessionId: 'ses',
              email: '',
              sessionCreatedAt: new Date(Date.now() - (stale ? 2 : 0) * FRESH_SESSION_WINDOW_MS),
            }
          },
        },
      },
    ],
  }).compile()
  const app = module.createNestApplication<NestExpressApplication>()
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT })
  await app.init()
  return app
}

const authed = <T extends request.Test>(call: T, token: string | undefined): T =>
  token === undefined ? call : call.set({ authorization: `Bearer ${token}` })

export const trpcQuery = (args: {
  app: INestApplication
  path: string
  token?: string | undefined
  input?: unknown
}): request.Test => {
  const query =
    args.input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(args.input))}`
  return authed(request(args.app.getHttpServer()).get(`/v1/trpc/${args.path}${query}`), args.token)
}

export const trpcMutation = (args: {
  app: INestApplication
  path: string
  token?: string | undefined
  input?: unknown
}): request.Test => {
  const call = authed(request(args.app.getHttpServer()).post(`/v1/trpc/${args.path}`), args.token)
  return args.input === undefined
    ? call.set('content-type', 'application/json')
    : call.send(JSON.stringify(args.input)).set('content-type', 'application/json')
}

export const dataOf = (body: unknown): unknown => {
  if (typeof body !== 'object' || body === null) return undefined
  const result: unknown = Reflect.get(body, 'result')
  if (typeof result !== 'object' || result === null) return undefined
  return Reflect.get(result, 'data')
}

export const errorMessageOf = (body: unknown): unknown => {
  if (typeof body !== 'object' || body === null) return undefined
  const error: unknown = Reflect.get(body, 'error')
  if (typeof error !== 'object' || error === null) return undefined
  return Reflect.get(error, 'message')
}
