import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedPrState, seedSubscription } from '../../../../test/github-seed'
import { seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { EventsService } from './events.service'
import { inertSignals } from './thread-signals.fixture'
import { ThreadsService } from './threads.service'
import { createSessionsRouterApp, mutate, query, session, USER_ID } from './threads-routers.fixture'

const linked = {
  repo: 'account-a/project',
  number: 42,
  url: 'https://github.com/account-a/project/pull/42',
  branch: 'client-reported-branch',
}

const readPullRequests = (body: unknown) => {
  const parsed = body as { result: { data: { pullRequests?: Array<Record<string, unknown>> } } }
  return parsed.result.data.pullRequests ?? []
}

describe('thread read cached PR metadata visibility', () => {
  useTestDatabase()
  let app: Awaited<ReturnType<typeof createSessionsRouterApp>>

  beforeEach(async () => {
    await seedUsers(USER_ID, USER_A)
    await seedThreadRow({ id: 'viewer-thread', userId: USER_ID })
    await seedPrState({
      repoFullName: linked.repo,
      prNumber: linked.number,
      title: 'Account A repository work',
      state: 'draft',
      checksRunning: 1,
      checksPassed: 4,
      checksFailed: 2,
      mergeable: false,
    })
    await seedSubscription({ userId: USER_A, repoFullName: linked.repo, prNumber: linked.number })
    const signals = inertSignals()
    app = await createSessionsRouterApp({
      threads: new ThreadsService(signals),
      events: new EventsService(signals),
      signals,
    })
    const appended = await mutate({
      app,
      procedure: 'threadEvents.append',
      headers: session,
      body: {
        threadId: 'viewer-thread',
        runId: 'run-link',
        drafts: [{ type: 'pull-request-linked', body: JSON.stringify(linked) }],
      },
    })
    expect(appended.status).toBe(200)
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns the reported link without another account cached metadata', async () => {
    const response = await query({
      app,
      procedure: 'threads.get',
      headers: session,
      input: { threadId: 'viewer-thread' },
    })
    expect(response.status).toBe(200)
    expect(readPullRequests(response.body)).toEqual([linked])
  })

  it('includes cached metadata for the viewer own live authorized agent target', async () => {
    await seedSubscription({ userId: USER_ID, repoFullName: linked.repo, prNumber: linked.number })
    const response = await query({
      app,
      procedure: 'threads.get',
      headers: session,
      input: { threadId: 'viewer-thread' },
    })
    expect(response.status).toBe(200)
    expect(readPullRequests(response.body)[0]).toMatchObject({
      ...linked,
      title: 'Account A repository work',
      state: 'draft',
      checksRunning: 1,
      checksPassed: 4,
      checksFailed: 2,
      mergeable: false,
    })
  })

  it('uses the freshest authorized cache row across repository casing aliases', async () => {
    await db.orm.public.GithubPrState.where({
      repoFullName: linked.repo,
      prNumber: linked.number,
    }).update({
      updatedAt: new Date(0),
    })
    await seedPrState({
      repoFullName: linked.repo.toUpperCase(),
      prNumber: linked.number,
      title: 'Newer repository snapshot',
      updatedAt: new Date(),
    })
    await seedSubscription({ userId: USER_ID, repoFullName: linked.repo, prNumber: linked.number })
    const response = await query({
      app,
      procedure: 'threads.get',
      headers: session,
      input: { threadId: 'viewer-thread' },
    })
    expect(response.status).toBe(200)
    expect(readPullRequests(response.body)[0]?.title).toBe('Newer repository snapshot')
  })

  it('does not expand an authorized agent target to another PR in the same repository', async () => {
    await seedSubscription({
      userId: USER_ID,
      repoFullName: linked.repo,
      prNumber: linked.number + 1,
    })
    const response = await query({
      app,
      procedure: 'threads.get',
      headers: session,
      input: { threadId: 'viewer-thread' },
    })
    expect(response.status).toBe(200)
    expect(readPullRequests(response.body)).toEqual([linked])
  })

  it('does not use an expired viewer target to grant cached metadata', async () => {
    await seedSubscription({
      userId: USER_ID,
      repoFullName: linked.repo,
      prNumber: linked.number,
      expiresAt: new Date(0),
      liveUntil: new Date(0),
    })
    const response = await query({
      app,
      procedure: 'threads.get',
      headers: session,
      input: { threadId: 'viewer-thread' },
    })
    expect(response.status).toBe(200)
    expect(readPullRequests(response.body)).toEqual([linked])
  })
})
