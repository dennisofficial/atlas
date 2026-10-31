import { NotFoundException } from '@nestjs/common'
import { createTRPCClient, httpSubscriptionLink, httpLink } from '@trpc/client'
import { EventSource } from 'eventsource'
import { mock } from 'bun:test'
import type { AppRouter } from '../../../../../../packages/api-router/src/generated/server'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import {
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { DrainStateService } from '../health/drain-state.service'
import { SandboxesService } from '../sandboxes/sandboxes.service'
import { ETokenPrincipalKind } from '../sandboxes/token-principal'
import { EventsService } from './events.service'
import { SessionOrSandboxMiddleware } from './session-or-sandbox.middleware'
import { ThreadEventsRouter } from './thread-events.router'
import { ThreadSignalsService } from './thread-signals.service'

export async function createLiveEventApp() {
  const drain = new DrainStateService()
  const signals = new ThreadSignalsService(drain)
  signals.threadChanged = () => {}
  const head = mock(async ({ userId, threadId }: { userId: string; threadId: string }) => {
    if (userId !== 'usr_1' || threadId !== 'thr_1') throw new NotFoundException('thread not found')
    return { head: 3 }
  })
  const app = await createMiddlewareApp({
    rateLimit: UNTHROTTLED_RATE_LIMIT,
    providers: [
      ThreadEventsRouter,
      SessionOrSandboxMiddleware,
      { provide: DrainStateService, useValue: drain },
      { provide: ThreadSignalsService, useValue: signals },
      { provide: EventsService, useValue: { head } },
      {
        provide: SESSION_VERIFIER,
        useValue: {
          verify: async (req: { headers: { cookie?: string } }) =>
            req.headers.cookie === 'ok' ? { userId: 'usr_1', sessionId: 'ses', email: '' } : null,
        },
      },
      {
        provide: SandboxesService,
        useValue: {
          verifyTokenPrincipal: async () => ({
            kind: ETokenPrincipalKind.Sandbox,
            id: 'sbx_1',
            threadId: 'thr_1',
            userId: 'usr_1',
          }),
          assertThreadInFamily: async () => undefined,
        },
      },
    ],
  })
  await app.listen(0)
  const url = `${await app.getUrl()}/v1/trpc`
  const client = (args: { sandbox?: boolean | undefined; lastEventId?: string | undefined } = {}) =>
    createTRPCClient<AppRouter>({
      links: [
        httpSubscriptionLink({
          url,
          EventSource,
          eventSourceOptions: () => ({
            fetch: (target, init) =>
              fetch(target, {
                ...init,
                headers: {
                  ...init?.headers,
                  ...(args.sandbox === true
                    ? { authorization: 'Bearer sandbox' }
                    : { cookie: 'ok' }),
                  ...(args.lastEventId === undefined ? {} : { 'last-event-id': args.lastEventId }),
                },
              }),
          }),
        }),
      ],
    })
  const queries = createTRPCClient<AppRouter>({
    links: [httpLink({ url, headers: { cookie: 'ok' } })],
  })
  return { app, signals, drain, client, queries }
}
