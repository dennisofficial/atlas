import type { NestExpressApplication } from '@nestjs/platform-express'
import { vi } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { SessionsRouter } from './sessions.router'
import { SessionsService } from './sessions.service'

export const sessions = {
  create: vi.fn(),
  list: vi.fn(),
  post: vi.fn(),
  events: vi.fn(),
  status: vi.fn(),
}

export const createSessionsApp = (): Promise<NestExpressApplication> =>
  createMiddlewareApp({
    rateLimit: UNTHROTTLED_RATE_LIMIT,
    providers: [
      SessionsRouter,
      SessionMiddleware,
      { provide: SessionsService, useValue: sessions },
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
