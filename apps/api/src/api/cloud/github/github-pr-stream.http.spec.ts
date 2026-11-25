import { EGithubPrStreamFrame, type GithubPrStreamFrame } from '@dltech/atlas-wire'
import { UnauthorizedException } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { createTRPCClient, httpSubscriptionLink } from '@trpc/client'
import { EventSource } from 'eventsource'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'bun:test'
import { waitFor } from '../../../../test/fake-timers'
import type { AppRouter } from '../../../../../../packages/api-router/src/generated/server'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import {
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { SessionMiddleware } from '../../../_module/session/session.middleware'
import { GithubPrEventMailboxService } from '@dltech/atlas-github'
import { GithubPrFanoutService } from '@dltech/atlas-github'
import { fakeGithub, fakeMailbox, fakeSubscriptions, STATE } from './github-pr-stream.fixture'
import { GithubService } from '@dltech/atlas-github'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { GithubPrStreamRouter } from './github-pr-stream.router'
import { GithubSubscriptionsService } from '@dltech/atlas-github'
import { GithubRequestCoordinator } from '@dltech/atlas-github'
import { localCoordinator } from '@dltech/atlas-github/testing'

const SANDBOX_TOKEN = 'sandbox-token'
const _HEARTBEAT: GithubPrStreamFrame = { type: EGithubPrStreamFrame.Heartbeat }
const _stateFrame = (state = STATE): GithubPrStreamFrame => ({
  type: EGithubPrStreamFrame.PrState,
  state,
})

type StreamFailure = { data?: { httpStatus?: number } | null | undefined }

describe('githubPrs.stream over a real http server', () => {
  let app: NestExpressApplication
  let url: string
  let fanout: GithubPrFanoutService
  let _open = 0
  const unsubscribers: Array<() => void> = []

  const subscribe = ({ token }: { token: string | undefined }) => {
    const frames: GithubPrStreamFrame[] = []
    const failures: StreamFailure[] = []
    const client = createTRPCClient<AppRouter>({
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
                  ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
                },
              }),
          }),
        }),
      ],
    })
    const subscription = client.githubPrs.stream.subscribe(undefined, {
      onData: (frame) => frames.push(frame),
      onError: (failure) => failures.push(failure),
    })
    unsubscribers.push(() => subscription.unsubscribe())
    return { frames, failures, unsubscribe: () => subscription.unsubscribe() }
  }

  beforeAll(async () => {
    vi.useRealTimers()
    const drain = new DrainStateService()
    fanout = new GithubPrFanoutService(drain)
    const openStream = fanout.openStream.bind(fanout)
    vi.spyOn(fanout, 'openStream').mockImplementation((args) => {
      _open += 1
      const close = openStream(args)
      let closed = false
      return () => {
        if (!closed) _open -= 1
        closed = true
        close()
      }
    })
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      providers: [
        GithubPrStreamRouter,
        SessionMiddleware,
        { provide: DrainStateService, useValue: drain },
        { provide: GithubPrFanoutService, useValue: fanout },
        { provide: GithubSubscriptionsService, useValue: fakeSubscriptions([STATE]) },
        { provide: GithubRequestCoordinator, useValue: localCoordinator() },
        { provide: GithubPrEventMailboxService, useValue: fakeMailbox() },
        { provide: GithubService, useValue: fakeGithub() },
        { provide: ThreadSignalsService, useValue: inertSignals() },
        { provide: SESSION_VERIFIER, useValue: { verify: async () => null } },
        {
          provide: SandboxesService,
          useValue: {
            async verifyTokenPrincipal({ token }: { token: string }) {
              if (token === SANDBOX_TOKEN) {
                return {
                  kind: 'sandbox',
                  id: 'sbx_1',
                  threadId: 'thr_1',
                  userId: 'usr_1',
                }
              }
              throw new UnauthorizedException()
            },
            assertThreadInFamily: async () => undefined,
          },
        },
      ],
    })
    await app.listen(0)
    url = `${await app.getUrl()}/v1/trpc`
  })

  afterEach(() => {
    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
  })

  afterAll(async () => {
    await app.close()
  })

  it('answers 401 to a bad token', async () => {
    const { frames, failures } = subscribe({ token: 'nope' })

    await waitFor(() => expect(failures).toHaveLength(1))

    expect(failures[0]?.data?.httpStatus).toBe(401)
    expect(frames).toEqual([])
  })

  it('answers 401 when no token is sent', async () => {
    const { frames, failures } = subscribe({ token: undefined })

    await waitFor(() => expect(failures).toHaveLength(1))

    expect(failures[0]?.data?.httpStatus).toBe(401)
    expect(frames).toEqual([])
  })
})
