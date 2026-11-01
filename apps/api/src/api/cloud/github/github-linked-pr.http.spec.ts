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
import type { GithubAppInstallNoticeService } from './github-app-install-notice.service'
import { PULL_REQUEST_PAYLOAD } from './github-delivery.fixture'
import { GithubDeliveryService } from './github-delivery.service'
import { GithubHookController } from './github-hook.controller'
import { GithubWebhookInboxService } from './github-webhook-inbox.service'
import { seedLinkedPr } from './github-linked-pr.fixture'
import { mockGithubHttp, realObservationGraph } from './github-observation-http.fixture'
import { GithubObservationStore } from './github-observation.store'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { GithubPrStreamRouter } from './github-pr-stream.router'
import { GithubSubscriptionsService } from './github-subscriptions.service'

const OWNER = 'usr-owner'
const OTHER = 'usr-other'
const states = (frames: GithubPrStatesFrame[]) =>
  frames.filter((frame) => frame.type === EGithubPrStatesFrame.PrState)

describe('authorized linked PR observation across real HTTP, Redis and Postgres', () => {
  useTestDatabase()
  let redis: RedisService
  let remote: RedisService
  let app: NestExpressApplication
  let api: ReturnType<typeof realObservationGraph>
  let delivery: ReturnType<typeof realObservationGraph>
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
  const subscribe = (
    userId: string,
    observe = [{ repo: 'compai/app', number: userId === OWNER ? 42 : 99 }],
  ) => {
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
                headers: { ...init?.headers, authorization: `Bearer ${userId}` },
              }),
          }),
        }),
      ],
    })
    const subscription = client.githubPrs.states.subscribe(
      { observe },
      { onData: (frame) => frames.push(frame) },
    )
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
    const prefix = `test:observe:http:${randomUUID()}:`
    const tokens = { [OWNER]: 'owner', [OTHER]: 'other' }
    api = realObservationGraph({ redis, prefix, tokens })
    delivery = realObservationGraph({ redis: remote, prefix, tokens, appBacked: false })
    await delivery.hooks.ensureHook({ userId: OWNER, repoFullName: 'CompAI/App' })
    const hook = await db.orm.public.GithubRepoHook.first({ repoFullName: 'compai/app' })
    if (hook === null) throw new Error('webhook transport was not established')
    hookSecret = hook.secret
    const subscriptions = new GithubSubscriptionsService(
      api.github,
      api.reads,
      api.hooks,
      {} as GithubAppInstallNoticeService,
      api.observations,
      { record: async () => undefined } as never,
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
        { provide: GithubObservationStore, useValue: api.observations },
        { provide: GithubDeliveryService, useValue: delivery.delivery },
        { provide: GithubSubscriptionsService, useValue: subscriptions },
        { provide: GithubPrEventMailboxService, useValue: api.mailbox },
        { provide: SecretCipherService, useValue: delivery.cipher },
        GithubWebhookInboxService,
        { provide: SandboxesService, useValue: { verifyTokenPrincipal: async () => null } },
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
    it(`delivers CI and cached reconnect replay with ${expired ? 'expired' : 'zero'} agent subscriptions, isolates another active observer, and releases on cancel`, async () => {
      if (expired) {
        await seedSubscription({ userId: OWNER, liveUntil: new Date(0), expiresAt: new Date(0) })
        await seedSubscription({ userId: OTHER, liveUntil: new Date(0), expiresAt: new Date(0) })
      }
      const owner = subscribe(OWNER)
      const other = subscribe(OTHER)
      await waitFor(() => {
        expect(
          owner.frames.some(
            (frame) => frame.type === EGithubPrStatesFrame.ObservationStatus && frame.available,
          ),
        ).toBe(true)
        expect(
          other.frames.some(
            (frame) => frame.type === EGithubPrStatesFrame.ObservationStatus && frame.available,
          ),
        ).toBe(true)
      })
      await deliver('pull_request', {
        ...PULL_REQUEST_PAYLOAD,
        repository: { full_name: 'CompAI/App' },
      })
      await waitFor(() =>
        expect(states(owner.frames).some((frame) => frame.state.checksPassed === 1)).toBe(true),
      )
      expect(states(other.frames)).toEqual([])
      owner.close()
      await waitFor(async () =>
        expect(
          await delivery.observations.owners({ repoFullName: 'compai/app', prNumber: 42 }),
        ).toEqual([]),
      )
      const reconnect = subscribe(OWNER)
      await waitFor(() => expect(states(reconnect.frames)).toHaveLength(1))
      expect(states(reconnect.frames)[0]).toMatchObject({
        state: { repoFullName: 'compai/app', prNumber: 42, checksPassed: 1 },
      })
      http.failChecks()
      await deliver('check_suite', {
        repository: { full_name: 'COMPAI/APP' },
        check_suite: { head_sha: 'abc123', head_branch: 'dennis/add-the-thing' },
      })
      await waitFor(() =>
        expect(states(reconnect.frames).some((frame) => frame.state.checksFailed === 1)).toBe(true),
      )
      expect(await db.orm.public.GithubPrEvent.all()).toEqual([])
      expect(await db.orm.public.GithubSubscription.all()).toHaveLength(expired ? 2 : 0)
      expect(api.wakes).toEqual([])
      expect(delivery.wakes).toEqual([])
      expect(states(other.frames)).toEqual([])
    })
  }
  it('refuses arbitrary caller identities even when private cached metadata exists', async () => {
    await seedPrState({ prNumber: 7, title: 'private unrelated PR' })
    const owner = subscribe(OWNER, [{ repo: 'compai/app', number: 7 }])
    await waitFor(() =>
      expect(
        owner.frames.some((frame) => frame.type === EGithubPrStatesFrame.ObservationStatus),
      ).toBe(true),
    )
    expect(states(owner.frames)).toEqual([])
    expect(await delivery.observations.owners({ repoFullName: 'compai/app', prNumber: 7 })).toEqual(
      [],
    )
  })
})
