import type { NestExpressApplication } from '@nestjs/platform-express'
import { vi } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { V2SessionsRouter } from './v2-sessions.router'
import { V2SessionsService } from './v2-sessions.service'
import { V2UserMiddleware } from './v2-user.middleware'

export const sessions = {
  create: vi.fn(),
  list: vi.fn(),
  post: vi.fn(),
  events: vi.fn(),
  status: vi.fn(),
}

export const createV2SessionsApp = (args?: {
  allowlist?: string | undefined
}): Promise<NestExpressApplication> =>
  createMiddlewareApp({
    rateLimit: UNTHROTTLED_RATE_LIMIT,
    envValues: { V2_USER_IDS: args?.allowlist },
    providers: [
      V2SessionsRouter,
      SessionMiddleware,
      V2UserMiddleware,
      { provide: V2SessionsService, useValue: sessions },
      {
        provide: SESSION_VERIFIER,
        useValue: {
          async verify(req: { headers: { authorization?: string } }) {
            const token = req.headers.authorization
            if (token === 'Bearer session-a')
              return { userId: 'user-a', sessionId: 'ses', email: '' }
            if (token === 'Bearer session-b')
              return { userId: 'user-b', sessionId: 'ses', email: '' }
            return null
          },
        },
      },
    ],
  })
