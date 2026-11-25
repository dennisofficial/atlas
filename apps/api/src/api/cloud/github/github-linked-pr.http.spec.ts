import { storeFixture } from '@dltech/atlas-github/testing'
import { createHmac, randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { EGithubPrStatesFrame, type GithubPrStatesFrame } from '@dltech/atlas-wire'
import { VersioningType } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { createTRPCClient, httpSubscriptionLink } from '@trpc/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { EventSource } from 'eventsource'
import { json } from 'express'
import request from 'supertest'
import type { AppRouter } from '../../../../../../packages/api-router/src/generated/server'
import { waitFor } from '../../../../test/fake-timers'
import { seedPrState, seedSubscription } from '../../../../test/github-seed'
import { createRealRedisService } from '../../../../test/real-redis.fixture'
import type { RedisService } from '../../../_lib/redis/redis.service'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { createMixedApp } from '../../platform/accounts/accounts.router.fixture'
import { DrainStateService } from '../../platform/health/drain-state.service'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { SessionOrSandboxMiddleware } from '../../platform/sessions/session-or-sandbox.middleware'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import type { GithubAppInstallNoticeService } from '@dltech/atlas-github'
import { PULL_REQUEST_PAYLOAD } from '@dltech/atlas-github/testing'
import { GithubDeliveryService } from '@dltech/atlas-github'
import { GithubHookController } from './github-hook.controller'
import { GithubWebhookInboxService } from '@dltech/atlas-github'
import { seedLinkedPr } from '@dltech/atlas-github/testing'
import { mockGithubHttp, realGithubGraph } from './github-realtime-http.fixture'
import { GithubRequestCoordinator } from '@dltech/atlas-github'
import { GithubPrEventMailboxService } from '@dltech/atlas-github'
import { GithubPrFanoutService } from '@dltech/atlas-github'
import { GithubPrStreamRouter } from './github-pr-stream.router'
import { GithubService } from '@dltech/atlas-github'
import { GithubSubscriptionsService } from '@dltech/atlas-github'

const OWNER = 'usr-owner'
const OTHER = 'usr-other'
const states = (frames: GithubPrStatesFrame[]) =>
  frames.filter((frame) => frame.type === EGithubPrStatesFrame.PrState)

describe('linked PR states across real HTTP, Redis and Postgres', () => {
  useTestDatabase()
  let redis: RedisService
  let remote: RedisService
  let app: NestExpressApplication
  let api: ReturnType<typeof realGithubGraph>
  let delivery: ReturnType<typeof realGithubGraph>
  let http: ReturnType<typeof mockGithubHttp>
  let url: string
  let hookSecret: string
  const closes: Array<() => void> = []
  beforeAll(async () => {
    redis = await createRealRedisService()
    remote = await createRealRedisService()
  })
  afterAll(async () => {
    await redis.onModuleDestroy()
    await remote.onModuleDestroy()
  })
  const subscribe = (userId: string) => {
    const frames: GithubPrStatesFrame[] = []
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
                  authorization: `Bearer ${userId}`,
                },
              }),
          }),
        }),
      ],
    })
    const subscription = client.githubPrs.states.subscribe(undefined, {
      onData: (frame) => frames.push(frame),
    })
    closes.push(() => subscription.unsubscribe())
    return { frames, close: () => subscription.unsubscribe() }
  }
  const deliver = async (event: string, payload: unknown) => {
    const body = JSON.stringify(payload)
    await request(app.getHttpServer())
      .post('/v1/github/hooks/compai%2Fapp')
      .set('content-type', 'application/json')
      .set('x-github-event', event)
      .set(
        'x-hub-signature-256',
        `sha256=${createHmac('sha256', hookSecret).update(body).digest('hex')}`,
      )
      .send(body)
      .expect(200)
  }
  beforeEach(async () => {
    http = mockGithubHttp()
    http.allowHooks()
    await seedLinkedPr()
    await seedLinkedPr({ threadId: 'teammate', repo: 'COMPAI/APP' })
    await seedLinkedPr({ userId: OTHER, number: 99 })
    const prefix = `test:states:http:${randomUUID()}:`
    const tokens = { [OWNER]: 'owner', [OTHER]: 'other' }
    api = realGithubGraph({ redis, prefix, tokens })
    delivery = realGithubGraph({
      redis: remote,
      prefix,
      tokens,
      appBacked: false,
    })
    await delivery.hooks.ensureHook({
      userId: OWNER,
      repoFullName: 'CompAI/App',
    })
    const hook = await db.orm.public.GithubRepoHook.first({
      repoFullName: 'compai/app',
    })
    if (hook === null) throw new Error('webhook transport was not established')
    hookSecret = hook.secret
    const subscriptions = new GithubSubscriptionsService(
      api.github,
      api.reads,
      api.hooks,
      {} as GithubAppInstallNoticeService,
      api.coordinator,
      { coversRepo: async () => false } as never,
      storeFixture(),
    )
    app = await createMixedApp({
      controllers: [GithubHookController],
      configure: (application) => {
        application.enableVersioning({ type: VersioningType.URI })
        application.use(
          json({
            verify: (incoming, _response, buffer) => {
              Object.assign(incoming, { rawBody: buffer })
            },
          }),
        )
      },
      providers: [
        GithubPrStreamRouter,
        SessionOrSandboxMiddleware,
        { provide: DrainStateService, useValue: new DrainStateService() },
        { provide: GithubPrFanoutService, useValue: api.fanout },
        { provide: GithubRequestCoordinator, useValue: api.coordinator },
        { provide: GithubDeliveryService, useValue: delivery.delivery },
        { provide: GithubSubscriptionsService, useValue: subscriptions },
        { provide: GithubPrEventMailboxService, useValue: api.mailbox },
        { provide: GithubService, useValue: api.github },
        { provide: ThreadSignalsService, useValue: api.signals },
        { provide: SecretCipherService, useValue: delivery.cipher },
        GithubWebhookInboxService,
        {
          provide: SandboxesService,
          useValue: { verifyTokenPrincipal: async () => null },
        },
        {
          provide: SESSION_VERIFIER,
          useValue: {
            verify: async (incoming: IncomingMessage) => {
              const userId = incoming.headers.authorization?.replace('Bearer ', '')
              return userId === OWNER || userId === OTHER
                ? { userId, sessionId: `session-${userId}`, email: '' }
                : null
            },
          },
        },
      ],
    })
    await app.listen(0)
    url = `${await app.getUrl()}/v1/trpc`
  })
  afterEach(async () => {
    for (const close of closes.splice(0)) close()
    await app.close()
    await api.fanout.onModuleDestroy()
    await delivery.fanout.onModuleDestroy()
    http.restore()
  })
  for (const expired of [false, true]) {
    it(`delivers CI and cached reconnect replay with ${expired ? 'expired' : 'zero'} agent subscriptions, without reaching another user`, async () => {
      if (expired) {
        await seedSubscription({
          userId: OWNER,
          liveUntil: new Date(0),
          expiresAt: new Date(0),
        })
        await seedSubscription({
          userId: OTHER,
          liveUntil: new Date(0),
          expiresAt: new Date(0),
        })
      }
      const owner = subscribe(OWNER)
      const other = subscribe(OTHER)
      await waitFor(() =>
        expect(owner.frames).toContainEqual({ type: EGithubPrStatesFrame.Heartbeat }),
      )
      await waitFor(() =>
        expect(other.frames).toContainEqual({ type: EGithubPrStatesFrame.Heartbeat }),
      )

      await deliver('pull_request', {
        ...PULL_REQUEST_PAYLOAD,
        repository: { full_name: 'CompAI/App' },
      })
      await waitFor(() =>
        expect(states(owner.frames).some((frame) => frame.state.mergeable === true)).toBe(true),
      )
      expect(states(other.frames)).toEqual([])

      const reconnect = subscribe(OWNER)
      await waitFor(() => expect(states(reconnect.frames)).toHaveLength(1))
      expect(states(reconnect.frames)[0]).toMatchObject({
        state: { repoFullName: 'compai/app', prNumber: 42, mergeable: true },
      })

      http.failChecks()
      await deliver('check_run', {
        repository: { full_name: 'COMPAI/APP' },
        check_run: {
          id: 2,
          name: 'lint',
          status: 'completed',
          conclusion: 'failure',
          started_at: '2026-11-02T04:25:00Z',
          completed_at: '2026-11-02T04:26:00Z',
          head_sha: 'abc123',
        },
      })
      await waitFor(() =>
        expect(states(reconnect.frames).some((frame) => frame.state.checksFailed === 2)).toBe(true),
      )
      expect(await db.orm.public.GithubPrEvent.all()).toEqual([])
      expect(await db.orm.public.GithubSubscription.all()).toHaveLength(expired ? 2 : 0)
      expect(states(other.frames)).toEqual([])
    })
  }
  it('never sends a caller the cached state of a PR no thread of theirs links', async () => {
    await seedPrState({ prNumber: 42, checksPassed: 2, version: 1 })
    await seedPrState({ prNumber: 7, title: 'private unrelated PR' })

    const owner = subscribe(OWNER)
    await waitFor(() =>
      expect(owner.frames).toContainEqual({ type: EGithubPrStatesFrame.Heartbeat }),
    )
    await waitFor(() => expect(states(owner.frames)).toHaveLength(1))

    expect(states(owner.frames).map((frame) => frame.state.prNumber)).toEqual([42])
  })
})
