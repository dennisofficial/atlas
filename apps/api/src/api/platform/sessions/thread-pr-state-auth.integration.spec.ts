import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { wireThreadSchema } from '@dltech/atlas-wire'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { seedConnection, seedPrState, seedSubscription } from '../../../../test/github-seed'
import { seedThreadRow } from '../../../../test/session-seed'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import { ThreadLauncher } from '../../../_core/ports/thread-launcher'
import { createMixedApp } from '../accounts/accounts.router.fixture'
import { DrainStateService } from '../health/drain-state.service'
import { SandboxesService } from '../sandboxes/sandboxes.service'
import { EventsService } from './events.service'
import { SessionOrSandboxMiddleware } from './session-or-sandbox.middleware'
import { ThreadArchiveService } from './thread-archive.service'
import { ThreadEventsRouter } from './thread-events.router'
import { ThreadReadService } from './thread-read.service'
import { inertSignals } from './thread-signals.fixture'
import { ThreadSignalsService } from './thread-signals.service'
import { ThreadsHistoryService } from './threads-history.service'
import { mutate, query } from './threads-routers.fixture'
import { ThreadsRouter } from './threads.router'
import { ThreadsService } from './threads.service'

const REPO = 'victim-private/confidential-roadmap'
const SECRET_TITLE = 'PRIVATE AUDIT MARKER: unreleased acquisition roadmap'
const THREAD_B = 'audit-attacker-thread'
const WORKSPACE_B = '/audit-attacker'

describe('initial PR cache visibility with authenticated accounts', () => {
  useTestDatabase()
  let app: NestExpressApplication
  let auth: typeof import('../auth/auth.server').auth

  beforeAll(async () => {
    ;({ auth } = await import('../auth/auth.server'))
    const { BetterAuthSessionVerifier } = await import('../auth/better-auth-session-verifier')
    const signals = inertSignals()
    app = await createMixedApp({
      providers: [
        ThreadsRouter,
        ThreadEventsRouter,
        SessionOrSandboxMiddleware,
        { provide: SESSION_VERIFIER, useClass: BetterAuthSessionVerifier },
        { provide: SandboxesService, useValue: {} },
        { provide: ThreadsService, useValue: new ThreadsService(signals) },
        { provide: EventsService, useValue: new EventsService(signals) },
        { provide: ThreadSignalsService, useValue: signals },
        { provide: DrainStateService, useValue: new DrainStateService() },
        { provide: ThreadsHistoryService, useValue: {} },
        { provide: ThreadArchiveService, useValue: {} },
        { provide: ThreadReadService, useValue: {} },
        { provide: ThreadLauncher, useValue: {} },
      ],
    })
  })

  afterAll(async () => {
    await app?.close()
  })

  async function signUp(email: string) {
    const result = await auth.api.signUpEmail({
      body: { email, name: email, password: 'audit-long-enough-password' },
      returnHeaders: true,
    })
    const cookie = result.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    expect(cookie.length).toBeGreaterThan(0)
    return { userId: result.response.user.id, headers: { cookie } }
  }

  it('keeps another account metadata out of the viewer own thread get and list', async () => {
    const victim = await signUp('audit-victim@test.local')
    const attacker = await signUp('audit-attacker@test.local')
    await seedThreadRow({ id: 'audit-victim-thread', userId: victim.userId })
    await seedConnection({ userId: victim.userId, sealedToken: 'audit-only-synthetic-token' })
    await seedSubscription({
      userId: victim.userId,
      threadId: 'audit-victim-thread',
      repoFullName: REPO,
      prNumber: 42,
    })
    await seedPrState({
      repoFullName: REPO,
      prNumber: 42,
      title: SECRET_TITLE,
      url: `https://github.com/${REPO}/pull/42`,
      headBranch: 'private/roadmap',
      checksRunning: 2,
      checksPassed: 17,
      checksFailed: 3,
      mergeable: false,
    })
    expect(
      await db.orm.public.GithubConnection.where({ userId: attacker.userId }).first(),
    ).toBeNull()
    expect(await db.orm.public.GithubSubscription.where({ userId: attacker.userId }).all()).toEqual(
      [],
    )

    const created = await mutate({
      app,
      procedure: 'threads.create',
      headers: attacker.headers,
      body: { id: THREAD_B, workspace: WORKSPACE_B },
    })
    expect(created.status).toBe(200)
    const denied = await query({
      app,
      procedure: 'threads.get',
      headers: attacker.headers,
      input: { threadId: 'audit-victim-thread' },
    })
    expect(denied.status).toBe(404)
    const anonymous = await query({ app, procedure: 'threads.get', input: { threadId: THREAD_B } })
    expect(anonymous.status).toBe(401)
    const before = await query({
      app,
      procedure: 'threads.get',
      headers: attacker.headers,
      input: { threadId: THREAD_B },
    })
    expect(wireThreadSchema.parse(before.body.result.data).pullRequests).toBeUndefined()

    const append = await mutate({
      app,
      procedure: 'threadEvents.append',
      headers: attacker.headers,
      body: {
        threadId: THREAD_B,
        runId: 'audit-forged-link',
        drafts: [
          {
            type: 'pull-request-linked',
            body: JSON.stringify({
              repo: REPO,
              number: 42,
              url: `https://github.com/${REPO}/pull/42`,
              branch: 'attacker-invented-branch',
            }),
          },
        ],
      },
    })
    expect(append.status).toBe(200)
    const get = await query({
      app,
      procedure: 'threads.get',
      headers: attacker.headers,
      input: { threadId: THREAD_B },
    })
    const list = await query({
      app,
      procedure: 'threads.list',
      headers: attacker.headers,
      input: { project: WORKSPACE_B },
    })
    expect(get.status).toBe(200)
    expect(list.status).toBe(200)
    const fetched = wireThreadSchema.parse(get.body.result.data)
    const listed = wireThreadSchema.array().parse(list.body.result.data)
    const reported = {
      repo: REPO,
      number: 42,
      url: `https://github.com/${REPO}/pull/42`,
      branch: 'attacker-invented-branch',
    }
    expect(fetched.pullRequests).toEqual([reported])
    expect(listed.find((thread) => thread.id === THREAD_B)?.pullRequests).toEqual([reported])
    expect(
      await db.orm.public.GithubConnection.where({ userId: attacker.userId }).first(),
    ).toBeNull()
    expect(await db.orm.public.GithubSubscription.where({ userId: attacker.userId }).all()).toEqual(
      [],
    )
  })
})
