import { UnauthorizedException, type Provider } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { vi } from 'bun:test'
import request from 'supertest'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { ThreadLauncher } from '../../../_core/ports/thread-launcher'
import type { VerifiedSession } from '../../../_core/types/auth.types'
import {
  as,
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { DrainStateService } from '../health/drain-state.service'
import { SandboxesService } from '../sandboxes/sandboxes.service'
import { ETokenPrincipalKind } from '../sandboxes/token-principal'
import { EventsService } from './events.service'
import { SessionOrSandboxMiddleware } from './session-or-sandbox.middleware'
import { inertSignals } from './thread-signals.fixture'
import { ThreadSignalsService } from './thread-signals.service'
import { ThreadArchiveService } from './thread-archive.service'
import { ThreadReadService } from './thread-read.service'
import { ThreadEventsRouter } from './thread-events.router'
import { ThreadTurnsRouter } from './thread-turns.router'
import { ThreadsHistoryService } from './threads-history.service'
import { ThreadsRouter } from './threads.router'
import { ThreadsService } from './threads.service'
import { TurnsService } from './turns.service'

export const SANDBOX_TOKEN = 'sandbox-token'
export const POD_TOKEN = 'pod-token'
export const USER_ID = 'usr-1'
export const SANDBOX_THREAD = 'thr-1'
export const CHILD_THREAD = 'thr-child'

const SESSION: VerifiedSession = { userId: USER_ID, sessionId: 'ses_1', email: 'a@b.c' }

export const WIRE_THREAD = {
  id: 'brn_1',
  head: 0,
  createdAt: '2026-10-22T10:00:00.000Z',
  updatedAt: '2026-10-22T10:00:00.000Z',
  workspace: null,
  repo: null,
}

export const session = { cookie: 'ok' }
export const sandbox = as(SANDBOX_TOKEN)
export const pod = as(POD_TOKEN)

export const assertThreadInFamily = vi.fn(
  async ({ sandboxThreadId, threadId }: { sandboxThreadId: string; threadId: string }) => {
    if (threadId !== sandboxThreadId && threadId !== CHILD_THREAD) throw new UnauthorizedException()
  },
)

const sandboxes = {
  async verifyTokenPrincipal({ token }: { token: string }) {
    if (token === SANDBOX_TOKEN) {
      return {
        kind: ETokenPrincipalKind.Sandbox,
        id: 'sbx-1',
        threadId: SANDBOX_THREAD,
        userId: USER_ID,
      }
    }
    if (token === POD_TOKEN) {
      return { kind: ETokenPrincipalKind.Pod, threadId: SANDBOX_THREAD, userId: USER_ID }
    }
    throw new UnauthorizedException()
  },
  assertThreadInFamily,
}

export type RouterFakes = {
  threads?: object
  history?: object
  archive?: object
  reads?: object
  launcher?: object
  events?: object
  turns?: object
  signals?: ThreadSignalsService
  drain?: DrainStateService
  extraProviders?: Provider[]
}

export function createSessionsRouterApp(fakes: RouterFakes = {}): Promise<NestExpressApplication> {
  return createMiddlewareApp({
    rateLimit: UNTHROTTLED_RATE_LIMIT,
    providers: [
      ThreadsRouter,
      ThreadEventsRouter,
      { provide: ThreadSignalsService, useValue: fakes.signals ?? inertSignals() },
      { provide: DrainStateService, useValue: fakes.drain ?? new DrainStateService() },
      ThreadTurnsRouter,
      SessionOrSandboxMiddleware,
      { provide: SESSION_VERIFIER, useValue: { verify: verifySession } },
      { provide: SandboxesService, useValue: sandboxes },
      { provide: ThreadsService, useValue: fakes.threads ?? {} },
      { provide: ThreadsHistoryService, useValue: fakes.history ?? {} },
      { provide: ThreadArchiveService, useValue: fakes.archive ?? {} },
      { provide: ThreadReadService, useValue: fakes.reads ?? {} },
      { provide: ThreadLauncher, useValue: fakes.launcher ?? {} },
      { provide: EventsService, useValue: fakes.events ?? {} },
      { provide: TurnsService, useValue: fakes.turns ?? {} },
      ...(fakes.extraProviders ?? []),
    ],
  })
}

async function verifySession(req: {
  headers: { cookie?: string | undefined }
}): Promise<VerifiedSession | null> {
  return req.headers.cookie === 'ok' ? SESSION : null
}

export const query = ({
  app,
  procedure,
  headers = {},
  input,
}: {
  app: NestExpressApplication
  procedure: string
  headers?: Record<string, string>
  input?: unknown
}) => {
  const suffix = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`
  return request(app.getHttpServer()).get(`/v1/trpc/${procedure}${suffix}`).set(headers)
}

export const mutate = ({
  app,
  procedure,
  headers = {},
  body = {},
}: {
  app: NestExpressApplication
  procedure: string
  headers?: Record<string, string>
  body?: object
}) => request(app.getHttpServer()).post(`/v1/trpc/${procedure}`).set(headers).send(body)
