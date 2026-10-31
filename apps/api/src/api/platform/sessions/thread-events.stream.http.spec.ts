import { EThreadStreamFrame, type ThreadStreamFrame } from '@dltech/atlas-wire'
import { NotFoundException } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { createTRPCClient, httpSubscriptionLink } from '@trpc/client'
import { EventSource } from 'eventsource'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'bun:test'
import { waitFor } from '../../../../test/fake-timers'
import type { AppRouter } from '../../../../../../packages/api-router/src/generated/server'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
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
import { ThreadEventsRouter } from './thread-events.router'
import { ThreadSignalsService } from './thread-signals.service'
import * as streamState from './thread-stream-state'
import * as podSnapshot from './pod-snapshot'
import { metadataFrame, podSnapshotFrame } from './thread-stream.fixture'

const SANDBOX_TOKEN = 'sandbox-token'
const OWNER_BEARER = 'owner-bearer'
const OWNED = 'thr_owned'
const HEAD = (head: number): ThreadStreamFrame => ({ type: EThreadStreamFrame.Head, head })

type StreamFailure = { data?: { httpStatus?: number } | null | undefined }

describe('threadEvents.stream over a real http server', () => {
  let app: NestExpressApplication
  let url: string
  let signals: ThreadSignalsService
  let head = 3
  const unsubscribers: Array<() => void> = []

  const append = vi.fn(async ({ threadId }: { threadId: string }) => {
    head += 1
    await signals.headMoved({ threadId, head })
    return []
  })

  const subscribe = ({ threadId, token }: { threadId: string; token: string | undefined }) => {
    const frames: ThreadStreamFrame[] = []
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
                  ...(token === undefined ? { cookie: 'ok' } : as(token)),
                },
              }),
          }),
        }),
      ],
    })
    const subscription = client.threadEvents.stream.subscribe(
      { threadId },
      { onData: (frame) => frames.push(frame), onError: (failure) => failures.push(failure) },
    )
    unsubscribers.push(() => subscription.unsubscribe())
    return { frames, failures }
  }

  beforeAll(async () => {
    vi.useRealTimers()
    vi.spyOn(streamState, 'readThreadMetadata').mockImplementation(async ({ threadId }) =>
      metadataFrame({ threadId }),
    )
    vi.spyOn(podSnapshot, 'readPodFrame').mockResolvedValue(podSnapshotFrame())
    const drain = new DrainStateService()
    signals = new ThreadSignalsService(drain)
    const events = {
      head: async ({ userId, threadId }: { userId: string; threadId: string }) => {
        if (userId !== 'usr_1' || threadId !== OWNED)
          throw new NotFoundException('thread not found')
        return { head }
      },
      append: ({ threadId }: { threadId: string }) => append({ threadId }),
    }
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      providers: [
        ThreadEventsRouter,
        SessionOrSandboxMiddleware,
        { provide: DrainStateService, useValue: drain },
        { provide: ThreadSignalsService, useValue: signals },
        { provide: EventsService, useValue: events },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            verify: async (req: { headers: { cookie?: string; authorization?: string } }) =>
              req.headers.cookie === 'ok' ||
              req.headers.authorization === as(OWNER_BEARER).authorization
                ? { userId: 'usr_1', sessionId: 'ses', email: '' }
                : null,
          },
        },
        {
          provide: SandboxesService,
          useValue: {
            async verifyTokenPrincipal({ token }: { token: string }) {
              if (token !== SANDBOX_TOKEN) throw new Error('bad token')
              return {
                kind: ETokenPrincipalKind.Sandbox,
                id: 'sbx_1',
                threadId: OWNED,
                userId: 'usr_1',
              }
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
    vi.restoreAllMocks()
  })

  it('streams the current head, then a head frame after threadEvents.append', async () => {
    const { frames } = subscribe({ threadId: OWNED, token: undefined })
    await waitFor(() =>
      expect(frames).toEqual([HEAD(head), metadataFrame({ threadId: OWNED }), podSnapshotFrame()]),
    )

    await append({ threadId: OWNED })

    await waitFor(() =>
      expect(frames).toEqual([
        HEAD(head - 1),
        metadataFrame({ threadId: OWNED }),
        podSnapshotFrame(),
        HEAD(head),
      ]),
    )
  })

  it('streams the head to an owner authenticating with a bearer session token', async () => {
    const { frames, failures } = subscribe({ threadId: OWNED, token: OWNER_BEARER })

    await waitFor(() =>
      expect(frames).toEqual([HEAD(head), metadataFrame({ threadId: OWNED }), podSnapshotFrame()]),
    )

    expect(failures).toEqual([])
  })

  it('answers 404 for a thread the caller does not own', async () => {
    const { frames, failures } = subscribe({ threadId: 'thr_other', token: undefined })

    await waitFor(() => expect(failures).toHaveLength(1))

    expect(failures[0]?.data?.httpStatus).toBe(404)
    expect(frames).toEqual([])
  })

  it('answers 403 to a sandbox token', async () => {
    const { frames, failures } = subscribe({ threadId: OWNED, token: SANDBOX_TOKEN })

    await waitFor(() => expect(failures).toHaveLength(1))

    expect(failures[0]?.data?.httpStatus).toBe(403)
    expect(frames).toEqual([])
  })

  it('answers 401 without credentials', async () => {
    const { failures } = subscribe({ threadId: OWNED, token: 'nope' })

    await waitFor(() => expect(failures).toHaveLength(1))

    expect(failures[0]?.data?.httpStatus).toBe(401)
  })
})
