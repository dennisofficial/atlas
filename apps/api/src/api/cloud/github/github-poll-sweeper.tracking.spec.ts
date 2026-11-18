import { db, type Row } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { chainEvents, toRunId, toThreadId } from '@dltech/atlas-core'
import { PG_CHANGE_CHANNEL } from '@dltech/atlas-protocol'
import pg from 'pg'
import type { RestPullRequest } from './github-pull-request-mapping'
import type { GithubHeadReads } from './github-head-reads'
import {
  preparePollSweeper,
  REST_FIELDS,
  seedPrState,
  serviceWith,
} from './github-poll-sweeper.fixture'

const REST_PULL: RestPullRequest = {
  number: 7,
  title: 'add the thing',
  html_url: 'https://github.com/compai/app/pull/7',
  state: 'open',
  draft: false,
  merged_at: null,
  mergeable: null,
  mergeable_state: 'unknown',
  head: { ref: 'dennis/feature', sha: 'abc123', repo: { full_name: 'compai/app' } },
  base: { ref: 'main' },
}

const seedTarget = (overrides: Partial<Row<'GithubTrackingTarget'>> = {}) =>
  db.orm.public.GithubTrackingTarget.create({
    userId: 'usr_1',
    kind: 'head',
    repoFullName: 'compai/app',
    branch: 'dennis/feature',
    prNumber: 0,
    lookedUpAt: null,
    liveUntil: new Date(Date.now() + 60 * 60_000),
    ...overrides,
  })

const fakeHeadReads = (
  args: { pulls?: Record<string, RestPullRequest[]>; parent?: Record<string, string | null> } = {},
) => {
  const pullsByHead = vi.fn(
    async (input: { repoFullName: string }) => args.pulls?.[input.repoFullName] ?? [],
  )
  const parentOf = vi.fn(
    async (input: { repoFullName: string }) => args.parent?.[input.repoFullName] ?? null,
  )
  return {
    reads: { pullsByHead, parentOf } as unknown as GithubHeadReads,
    pullsByHead,
    parentOf,
  }
}

const covered = () =>
  db.orm.public.GithubAppInstallation.create({
    installationId: 11n,
    accountLogin: 'compai',
    accountType: 'Organization',
    repos: ['compai/app'],
    suspendedAt: null,
  })

const trackHead = async (args: { sessionId: string; branch: string }): Promise<void> => {
  const plane = new ControlPlane({ store: new PostgresControlStore(db) })
  await plane.createSession({
    sessionId: args.sessionId,
    userId: 'usr_1',
    projectId: 'proj_1',
    mainThreadId: `${args.sessionId}-thread`,
  })
  const lease = await plane.grant({ sessionId: args.sessionId, hostId: 1 })
  const outcome = await plane.append({
    threadId: `${args.sessionId}-thread`,
    epoch: lease.epoch,
    events: chainEvents({
      threadId: toThreadId(`${args.sessionId}-thread`),
      runId: toRunId('run-1'),
      epoch: lease.epoch,
      at: new Date().toISOString(),
      bodies: [
        {
          type: 'branches-observed',
          repo: '/work/app',
          head: args.branch,
          base: 'main',
          branches: [{ name: args.branch, sha: 'abc123' }],
          worktrees: [],
          remotes: [{ name: 'origin', url: 'git@github.com:compai/app.git' }],
        },
      ],
    }),
  })
  expect(outcome.ok).toBe(true)
}

describe('GithubPollSweeperService tracking targets', () => {
  useTestDatabase()

  beforeEach(preparePollSweeper)

  it('looks up a new head target once on an app-covered repo and never polls it', async () => {
    const head = fakeHeadReads({ pulls: { 'compai/app': [REST_PULL] } })
    const readPullRequest = vi.fn(async () => {
      throw new Error('a covered repo is never polled')
    })
    const { service } = serviceWith({
      tokens: { usr_1: 'ghu_1' },
      headReads: head.reads,
      readPullRequest,
    })
    await covered()
    const target = await seedTarget()

    await service.handlePoll()
    await service.handlePoll()

    expect(head.pullsByHead).toHaveBeenCalledTimes(1)
    expect(readPullRequest).not.toHaveBeenCalled()
    const row = await db.orm.public.GithubTrackingTarget.where({ id: target.id }).first()
    expect(row?.lookedUpAt).not.toBeNull()
  })

  it('polls an uncovered repo on every sweep once the first lookup is spent', async () => {
    const head = fakeHeadReads({ pulls: { 'compai/app': [REST_PULL] } })
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, headReads: head.reads })

    await seedTarget({ lookedUpAt: new Date(Date.now() - 60_000) })
    await service.handlePoll()

    expect(head.pullsByHead).toHaveBeenCalledTimes(1)
  })

  it('keeps refreshing the pull requests a polled head found, with no subscription', async () => {
    const head = fakeHeadReads({ pulls: { 'compai/app': [REST_PULL] } })
    const readPullRequest = vi.fn(async () => ({
      ...REST_FIELDS,
      state: 'merged',
      mergeable: true,
    }))
    const { service } = serviceWith({
      tokens: { usr_1: 'ghu_1' },
      headReads: head.reads,
      readPullRequest,
    })
    await seedTarget()
    await seedPrState({
      repoFullName: 'compai/app',
      prNumber: 7,
      headBranch: 'dennis/feature',
      headRepoFullName: 'compai/app',
      state: 'open',
      updatedAt: new Date(Date.now() - 3_600_000),
    })

    await service.handlePoll()

    expect(readPullRequest).toHaveBeenCalled()
    const row = await db.orm.public.GithubPrState.where({
      repoFullName: 'compai/app',
      prNumber: 7,
    }).first()
    expect(row?.state).toBe('merged')
  })

  it('renews a head target while a live session still tracks its branch', async () => {
    const head = fakeHeadReads({ pulls: { 'compai/app': [REST_PULL] } })
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, headReads: head.reads })
    await trackHead({ sessionId: 'ses_tracked', branch: 'dennis/feature' })
    const target = await seedTarget({ liveUntil: new Date(Date.now() + 60_000) })

    await service.handlePoll()

    const row = await db.orm.public.GithubTrackingTarget.where({ id: target.id }).first()
    expect(row?.liveUntil.getTime()).toBeGreaterThan(Date.now() + 60_000)
  })

  it('stops polling a repo the App covers mid-session, without touching the target', async () => {
    const head = fakeHeadReads({ pulls: { 'compai/app': [REST_PULL] } })
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, headReads: head.reads })
    const target = await seedTarget()

    await service.handlePoll()
    await covered()
    await db.orm.public.GithubTrackingTarget.where({ id: target.id }).update({
      lookedUpAt: new Date(Date.now() - 60_000),
    })
    await service.handlePoll()

    expect(head.pullsByHead).toHaveBeenCalledTimes(1)
    const rows = await db.orm.public.GithubTrackingTarget.where({ userId: 'usr_1' }).all()
    expect(rows).toHaveLength(1)
  })

  it('finds the upstream PR of a fork head', async () => {
    const head = fakeHeadReads({
      parent: { 'dennis/fork': 'compai/app' },
      pulls: { 'compai/app': [REST_PULL] },
    })
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, headReads: head.reads })
    await seedTarget({ repoFullName: 'dennis/fork' })

    await service.handlePoll()

    expect(head.pullsByHead).toHaveBeenCalledWith(
      expect.objectContaining({ repoFullName: 'compai/app', headRepoFullName: 'dennis/fork' }),
    )
    const row = await db.orm.public.GithubPrState.where({
      repoFullName: 'compai/app',
      prNumber: 7,
    }).first()
    expect(row?.headBranch).toBe('dennis/feature')
    expect(row?.headRepoFullName).toBe('compai/app')
  })

  it('leaves a target past liveUntil alone', async () => {
    const head = fakeHeadReads({ pulls: { 'compai/app': [REST_PULL] } })
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, headReads: head.reads })
    await seedTarget({ liveUntil: new Date(Date.now() - 60_000) })

    await service.handlePoll()

    expect(head.pullsByHead).not.toHaveBeenCalled()
  })

  it('announces a session that only tracks the polled head', async () => {
    const heard: string[] = []
    const listener = new pg.Client(process.env.DATABASE_URL)
    await listener.connect()
    listener.on('notification', (message) => {
      if (message.payload === undefined) return
      heard.push((JSON.parse(message.payload) as { sessionId: string }).sessionId)
    })
    await listener.query(`LISTEN ${PG_CHANGE_CHANNEL}`)
    try {
      const head = fakeHeadReads({ pulls: { 'compai/app': [REST_PULL] } })
      const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, headReads: head.reads })
      await trackHead({ sessionId: 'ses_head_only', branch: 'dennis/feature' })
      await seedTarget()
      await new Promise((resolve) => setTimeout(resolve, 200))
      heard.length = 0

      await service.handlePoll()
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(heard).toContain('ses_head_only')
    } finally {
      await listener.end()
    }
  })

  it('never writes a delivery or inbox row for a tracked head', async () => {
    const head = fakeHeadReads({ pulls: { 'compai/app': [REST_PULL] } })
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, headReads: head.reads })
    await seedTarget()

    await service.handlePoll()

    expect(await db.orm.public.GithubPrEventDelivery.all()).toHaveLength(0)
    expect(await db.orm.public.GithubWebhookInbox.all()).toHaveLength(0)
  })
})
