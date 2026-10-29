import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import type { VerifiedSession } from '../../../_core/types/auth.types'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { cipher } from './sandboxes.fixture'
import { SandboxCheckpointRouter } from './sandbox-checkpoint.router'
import { SandboxTokenMiddleware } from './sandbox-token.middleware'
import { SandboxesRouter } from './sandboxes.router'
import { SandboxesService } from './sandboxes.service'
import type { VercelSandboxClient } from './vercel-sandbox.client'
import { inertSignals } from '../sessions/thread-signals.fixture'
import { ThreadSignalsService } from '../sessions/thread-signals.service'

export const USER_HEADER = 'x-test-user'

export const asUser = (userId: string): Record<string, string> => ({ [USER_HEADER]: userId })

export const asBearer = (token: string): { authorization: string } => ({
  authorization: `Bearer ${token}`,
})

export const checkpointPath = (procedure: 'get' | 'put'): string =>
  `/v1/trpc/sandboxCheckpoint.${procedure}`

export const sandboxesPath = (procedure: string): string => `/v1/trpc/sandboxes.${procedure}`

export const queryOf = (input: unknown): string =>
  `?input=${encodeURIComponent(JSON.stringify(input))}`

const verifier = {
  async verify(request: { headers: Record<string, unknown> }): Promise<VerifiedSession | null> {
    const userId = request.headers[USER_HEADER]
    if (typeof userId !== 'string') return null
    return { userId, sessionId: 'session-1', email: `${userId}@atlas.dev` }
  },
}

export const inertVercel = {} as unknown as VercelSandboxClient

export const sandboxRoutersService = (): SandboxesService =>
  new SandboxesService(inertVercel, cipher, inertSignals())

export function createSandboxRoutersApp(
  service: SandboxesService = sandboxRoutersService(),
  rateLimit: number = UNTHROTTLED_RATE_LIMIT,
): Promise<NestExpressApplication> {
  return createMiddlewareApp({
    rateLimit,
    providers: [
      SandboxesRouter,
      SandboxCheckpointRouter,
      { provide: ThreadSignalsService, useValue: inertSignals() },
      SessionMiddleware,
      SandboxTokenMiddleware,
      { provide: SESSION_VERIFIER, useValue: verifier },
      { provide: SandboxesService, useValue: service },
    ],
  })
}

export const getCheckpoint = ({
  app,
  userId,
  threadId,
}: {
  app: INestApplication
  userId: string | undefined
  threadId: string
}) => {
  const call = request(app.getHttpServer()).get(`${checkpointPath('get')}${queryOf({ threadId })}`)
  return userId === undefined ? call : call.set(asUser(userId))
}

export const putCheckpoint = ({
  app,
  token,
  body,
}: {
  app: INestApplication
  token: string | undefined
  body: unknown
}) => {
  const call = request(app.getHttpServer()).post(checkpointPath('put'))
  const authed = token === undefined ? call : call.set(asBearer(token))
  return authed.send(body as object)
}
