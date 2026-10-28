import type { Provider } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { vi } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import {
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { PodLeasesRouter } from './pod-leases.router'
import { PodLeasesService } from './pod-leases.service'

export const leases = { register: vi.fn(), release: vi.fn() }

export const createPodLeasesApp = (args?: {
  extra?: Provider[]
  service?: Provider
}): Promise<NestExpressApplication> =>
  createMiddlewareApp({
    rateLimit: UNTHROTTLED_RATE_LIMIT,
    providers: [
      PodLeasesRouter,
      SessionMiddleware,
      args?.service ?? { provide: PodLeasesService, useValue: leases },
      {
        provide: SESSION_VERIFIER,
        useValue: {
          async verify(req: { headers: { authorization?: string } }) {
            if (req.headers.authorization !== 'Bearer session-a') return null
            return { userId: 'user-a', sessionId: 'ses', email: '' }
          },
        },
      },
      ...(args?.extra ?? []),
    ],
  })
