import type { NestExpressApplication } from '@nestjs/platform-express'
import { vi } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { FilesRouter } from './files.router'
import { FilesService } from './files.service'

export const files = { tree: vi.fn(), search: vi.fn(), read: vi.fn() }

export const createFilesApp = (): Promise<NestExpressApplication> =>
  createMiddlewareApp({
    rateLimit: UNTHROTTLED_RATE_LIMIT,
    providers: [
      FilesRouter,
      SessionMiddleware,
      { provide: FilesService, useValue: files },
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
