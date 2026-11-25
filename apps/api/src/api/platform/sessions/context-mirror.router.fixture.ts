import type { NestExpressApplication } from '@nestjs/platform-express'
import { vi } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { ContextMirrorRouter } from './context-mirror.router'
import { ContextMirrorService } from './context-mirror.service'

export const mirror = { list: vi.fn(), read: vi.fn() }

export const createContextMirrorApp = (): Promise<NestExpressApplication> =>
  createMiddlewareApp({
    rateLimit: UNTHROTTLED_RATE_LIMIT,
    providers: [
      ContextMirrorRouter,
      SessionMiddleware,
      { provide: ContextMirrorService, useValue: mirror },
      {
        provide: SESSION_VERIFIER,
        useValue: {
          async verify(req: { headers: { authorization?: string } }) {
            const token = req.headers.authorization
            if (token === 'Bearer session-a')
              return { userId: 'user-a', sessionId: 'ses', email: '' }
            return null
          },
        },
      },
    ],
  })
