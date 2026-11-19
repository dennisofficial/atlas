import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { PG_CHANGE_CHANNEL } from '@dltech/atlas-protocol'
import pg from 'pg'
import {
  covered,
  fakeHeadReads,
  preparePollSweeper,
  REST_FIELDS,
  REST_PULL,
  seedPrState,
  seedTarget,
  serviceWith,
  trackHead,
} from './github-poll-sweeper.fixture'

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

  it('records a discovered pull without the mergeability only an applied read can know', async () => {
    const head = fakeHeadReads({
      pulls: { 'compai/app': [{ ...REST_PULL, mergeable: true, mergeable_state: 'clean' }] },
    })
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, headReads: head.reads })
    await covered()
    await seedTarget()

    await service.handlePoll()

    const row = await db.orm.public.GithubPrState.where({
      repoFullName: 'compai/app',
      prNumber: 7,
    }).first()
    expect(row?.title).toBe('add the thing')
    expect(row?.mergeable).toBeNull()
    expect(row?.mergeableObservedAt).toBeNull()
  })

  it('stamps a first lookup whose sample is older than the row it raced, without retrying', async () => {
    const readPullRequest = vi.fn(async () => {
      await db.orm.public.GithubPrState.where({
        repoFullName: 'compai/app',
        prNumber: 42,
      }).update({
        state: 'merged',
        pullUpdatedAt: new Date(Date.now() + 60_000),
      })
      return { ...REST_FIELDS, state: 'open' }
    })
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await seedPrState({ prNumber: 42, state: 'open', updatedAt: new Date(Date.now() - 60_000) })
    const target = await seedTarget({ kind: 'pull-request', prNumber: 42 })

    await service.handlePoll()

    const stamped = await db.orm.public.GithubTrackingTarget.where({ id: target.id }).first()
    expect(stamped?.lookedUpAt).not.toBeNull()
    expect(stamped?.attemptedAt).not.toBeNull()
    expect(
      (
        await db.orm.public.GithubPrState.where({
          repoFullName: 'compai/app',
          prNumber: 42,
        }).first()
      )?.state,
    ).toBe('merged')

    await service.handlePoll()

    expect(
      (
        await db.orm.public.GithubPrState.where({
          repoFullName: 'compai/app',
          prNumber: 42,
        }).first()
      )?.state,
    ).toBe('merged')
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
    expect(rows.filter((row) => row.kind === 'head')).toHaveLength(1)
    expect(rows.filter((row) => row.kind === 'pull-request')).toHaveLength(1)
  })

  it('finds the upstream PR of a fork head', async () => {
    const head = fakeHeadReads({
      parent: { 'dennis/fork': 'compai/app' },
      pulls: { 'compai/app': [REST_PULL] },
    })
    const readPullRequest = vi.fn(async () => ({ ...REST_FIELDS, headBranch: 'dennis/feature' }))
    const { service } = serviceWith({
      tokens: { usr_1: 'ghu_1' },
      headReads: head.reads,
      readPullRequest,
    })
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

  it('refreshes the upstream pull request rather than the fork row sharing its number', async () => {
    const head = fakeHeadReads({
      parent: { 'dennis/fork': 'compai/app' },
      pulls: { 'compai/app': [REST_PULL] },
    })
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
    const stale = new Date(Date.now() - 3_600_000)
    await seedPrState({
      repoFullName: 'dennis/fork',
      prNumber: 7,
      headBranch: 'dennis/other',
      state: 'open',
      updatedAt: stale,
      pullUpdatedAt: stale,
    })
    await seedPrState({
      repoFullName: 'compai/app',
      prNumber: 7,
      headBranch: 'dennis/feature',
      state: 'open',
      updatedAt: stale,
      pullUpdatedAt: stale,
    })
    await seedTarget({ repoFullName: 'dennis/fork' })

    await service.handlePoll()

    expect(readPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'app', number: 7 }),
    )
    expect(
      (
        await db.orm.public.GithubPrState.where({
          repoFullName: 'compai/app',
          prNumber: 7,
        }).first()
      )?.state,
    ).toBe('merged')
    expect(
      (
        await db.orm.public.GithubPrState.where({
          repoFullName: 'dennis/fork',
          prNumber: 7,
        }).first()
      )?.state,
    ).toBe('open')
  })

  it('leaves a target past liveUntil alone', async () => {
    const head = fakeHeadReads({ pulls: { 'compai/app': [REST_PULL] } })
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, headReads: head.reads })
    await seedTarget({ liveUntil: new Date(Date.now() - 60_000) })

    await service.handlePoll()

    expect(head.pullsByHead).not.toHaveBeenCalled()
  })

  it('announces the session tracking the applied head and no other', async () => {
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
      await trackHead({ sessionId: 'ses_elsewhere', branch: 'dennis/other' })
      await seedTarget()
      await new Promise((resolve) => setTimeout(resolve, 200))
      heard.length = 0

      await service.handlePoll()
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(heard).toEqual(['ses_head_only'])
    } finally {
      await listener.end()
    }
  })
})
