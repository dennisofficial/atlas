import type { NestExpressApplication } from '@nestjs/platform-express'
import { vi } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { TerminalRouter } from './terminal.router'
import { TerminalService } from './terminal.service'

export const terminals = {
  list: vi.fn(),
  open: vi.fn(),
  rename: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  close: vi.fn(),
  read: vi.fn(),
}

export const createTerminalApp = (): Promise<NestExpressApplication> =>
  createMiddlewareApp({
    rateLimit: UNTHROTTLED_RATE_LIMIT,
    providers: [
      TerminalRouter,
      SessionMiddleware,
      { provide: TerminalService, useValue: terminals },
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
