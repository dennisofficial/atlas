import { UnauthorizedException, type INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import {
  as,
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { SessionOrSandboxMiddleware } from '../../platform/sessions/session-or-sandbox.middleware'
import { SandboxesService } from '../../platform/sandboxes/sandboxes.service'
import { ETokenPrincipalKind } from '../../platform/sandboxes/token-principal'
import { GithubSubscriptionsRouter } from './github-subscriptions.router'
import { GithubSubscriptionsService } from './github-subscriptions.service'

const SANDBOX_TOKEN = 'sandbox-token'
const POD_TOKEN = 'pod-token'
const SESSION_TOKEN = 'session-token'
const EXPIRES_AT = '2026-10-09T00:05:00.000Z'

const subscriptions = {
  subscribe: vi.fn(async (_args: object) => ({
    id: 'sub_1',
    repoFullName: 'compai/app',
    prNumber: 42,
    branch: 'dennis/add-the-thing',
    pollBacked: false,
    expiresAt: EXPIRES_AT,
    state: null,
  })),
  unsubscribe: vi.fn(async (_args: object) => undefined),
  dismissAppInstallNotice: vi.fn(async (_args: object) => undefined),
  heartbeat: vi.fn(async (_args: object) => ({ expiresAt: EXPIRES_AT })),
}

const sandboxes = {
  async verifyTokenPrincipal({ token }: { token: string }) {
    if (token === SANDBOX_TOKEN) {
      return { kind: ETokenPrincipalKind.Sandbox, id: 'sbx_1', threadId: 'thr_1', userId: 'usr_1' }
    }
    if (token === POD_TOKEN) {
      return { kind: ETokenPrincipalKind.Pod, threadId: 'thr_1', userId: 'usr_1' }
    }
    throw new UnauthorizedException()
  },
  assertThreadInFamily: async () => undefined,
}

const verifier = {
  async verify(req: { headers: { authorization?: string } }) {
    if (req.headers.authorization !== `Bearer ${SESSION_TOKEN}`) return null
    return { userId: 'usr_1', sessionId: 'ses_1', email: '' }
  },
}

const SUBSCRIBE = { repoFullName: 'compai/app', prNumber: 42 }

describe('GithubSubscriptionsRouter', () => {
  let app: INestApplication

  const call = ({
    procedure,
    token,
    body,
  }: {
    procedure: string
    token: string | undefined
    body: object
  }) => {
    const pending = request(app.getHttpServer()).post(`/v1/trpc/githubSubscriptions.${procedure}`)
    return (token === undefined ? pending : pending.set(as(token))).send(body)
  }

  beforeAll(async () => {
    app = await createMiddlewareApp({
      rateLimit: UNTHROTTLED_RATE_LIMIT,
      providers: [
        GithubSubscriptionsRouter,
        SessionOrSandboxMiddleware,
        { provide: GithubSubscriptionsService, useValue: subscriptions },
        { provide: SESSION_VERIFIER, useValue: verifier },
        { provide: SandboxesService, useValue: sandboxes },
      ],
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    for (const fake of Object.values(subscriptions)) fake.mockClear()
  })

  it('passes the sandbox principal through on subscribe', async () => {
    const reply = await call({ procedure: 'subscribe', token: SANDBOX_TOKEN, body: SUBSCRIBE })

    expect(reply.status).toBe(200)
    expect(subscriptions.subscribe).toHaveBeenCalledWith({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
      threadId: 'thr_1',
    })
  })

  it('a user-session subscribe carries no link', async () => {
    const reply = await call({ procedure: 'subscribe', token: SESSION_TOKEN, body: SUBSCRIBE })

    expect(reply.status).toBe(200)
    expect(subscriptions.subscribe).toHaveBeenCalledWith({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
    })
  })

  it('subscribes to a branch', async () => {
    const reply = await call({
      procedure: 'subscribe',
      token: SESSION_TOKEN,
      body: { repoFullName: 'compai/app', branch: 'main' },
    })

    expect(reply.status).toBe(200)
    expect(subscriptions.subscribe).toHaveBeenCalledWith({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      branch: 'main',
    })
  })

  it('passes the sandbox principal through on heartbeat', async () => {
    const reply = await call({
      procedure: 'heartbeat',
      token: SANDBOX_TOKEN,
      body: { id: 'sub_1' },
    })

    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ result: { data: { expiresAt: EXPIRES_AT } } })
    expect(subscriptions.heartbeat).toHaveBeenCalledWith({
      userId: 'usr_1',
      subscriptionId: 'sub_1',
      threadId: 'thr_1',
    })
  })

  it('a user-session heartbeat carries no link', async () => {
    const reply = await call({
      procedure: 'heartbeat',
      token: SESSION_TOKEN,
      body: { id: 'sub_1' },
    })

    expect(reply.status).toBe(200)
    expect(subscriptions.heartbeat).toHaveBeenCalledWith({
      userId: 'usr_1',
      subscriptionId: 'sub_1',
    })
  })

  it('unsubscribe and dismiss return void', async () => {
    const unsubscribed = await call({
      procedure: 'unsubscribe',
      token: SESSION_TOKEN,
      body: { id: 'sub_1' },
    })
    const dismissed = await call({
      procedure: 'dismissAppInstallNotice',
      token: SESSION_TOKEN,
      body: { repoFullName: 'compai/app' },
    })

    expect(unsubscribed.status).toBe(200)
    expect(unsubscribed.body.result.data ?? null).toBeNull()
    expect(dismissed.status).toBe(200)
    expect(dismissed.body.result.data ?? null).toBeNull()
    expect(subscriptions.unsubscribe).toHaveBeenCalledWith({
      userId: 'usr_1',
      subscriptionId: 'sub_1',
    })
    expect(subscriptions.dismissAppInstallNotice).toHaveBeenCalledWith({
      userId: 'usr_1',
      repoFullName: 'compai/app',
    })
  })

  it.each([
    ['subscribe', SUBSCRIBE],
    ['unsubscribe', { id: 'sub_1' }],
    ['dismissAppInstallNotice', { repoFullName: 'compai/app' }],
    ['heartbeat', { id: 'sub_1' }],
  ])('lets a sandbox token reach %s', async (procedure, body) => {
    const reply = await call({ procedure, token: SANDBOX_TOKEN, body })

    expect(reply.status).toBe(200)
  })

  it.each([
    ['subscribe', SUBSCRIBE],
    ['unsubscribe', { id: 'sub_1' }],
    ['heartbeat', { id: 'sub_1' }],
  ])('lets a pod token reach %s', async (procedure, body) => {
    const reply = await call({ procedure, token: POD_TOKEN, body })

    expect(reply.status).toBe(200)
  })

  it('refuses a pod token on dismissAppInstallNotice', async () => {
    const reply = await call({
      procedure: 'dismissAppInstallNotice',
      token: POD_TOKEN,
      body: { repoFullName: 'compai/app' },
    })

    expect(reply.status).toBe(403)
  })

  it('a pod subscribe carries no sandbox link', async () => {
    const reply = await call({ procedure: 'subscribe', token: POD_TOKEN, body: SUBSCRIBE })

    expect(reply.status).toBe(200)
    expect(subscriptions.subscribe).toHaveBeenCalledWith({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      prNumber: 42,
    })
  })

  it('answers 401 without a token or session', async () => {
    const reply = await call({ procedure: 'subscribe', token: undefined, body: SUBSCRIBE })

    expect(reply.status).toBe(401)
  })

  it.each([
    ['both prNumber and branch', { repoFullName: 'compai/app', prNumber: 42, branch: 'main' }],
    ['neither prNumber nor branch', { repoFullName: 'compai/app' }],
  ])('answers 400 for %s', async (_label, body) => {
    const reply = await call({ procedure: 'subscribe', token: SESSION_TOKEN, body })

    expect(reply.status).toBe(400)
    expect(subscriptions.subscribe).not.toHaveBeenCalled()
  })
})
