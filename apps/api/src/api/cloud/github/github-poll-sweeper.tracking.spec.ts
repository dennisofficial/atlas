import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, setSystemTime, vi } from 'bun:test'
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

  it('retries a superseded first lookup on the next sweep, then stamps it', async () => {
    let overtaken = true
    const readPullRequest = vi.fn(async () => {
      if (overtaken) {
        const held = await db.orm.public.GithubPrState.where({
          repoFullName: 'compai/app',
          prNumber: 42,
        }).first()
        await db.orm.public.GithubPrState.where({
          repoFullName: 'compai/app',
          prNumber: 42,
        }).update({ state: 'merged', version: (held?.version ?? 0) + 1 })
        return { ...REST_FIELDS, state: 'open' }
      }
      return REST_FIELDS
    })
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, readPullRequest })
    await covered()
    await seedPrState({ prNumber: 42, state: 'open', updatedAt: new Date(Date.now() - 60_000) })
    const target = await seedTarget({ kind: 'pull-request', prNumber: 42 })
    const startedAt = Date.now()

    await service.handlePoll()

    const overtakenRow = await db.orm.public.GithubTrackingTarget.where({ id: target.id }).first()
    expect(overtakenRow?.lookedUpAt).toBeNull()
    expect(overtakenRow?.attemptedAt).not.toBeNull()
    expect(
      (
        await db.orm.public.GithubPrState.where({
          repoFullName: 'compai/app',
          prNumber: 42,
        }).first()
      )?.state,
    ).toBe('merged')

    overtaken = false
    setSystemTime(new Date(startedAt + 31_000))
    try {
      await service.handlePoll()
    } finally {
      setSystemTime()
    }

    const landed = await db.orm.public.GithubTrackingTarget.where({ id: target.id }).first()
    expect(landed?.lookedUpAt).not.toBeNull()
    expect(readPullRequest).toHaveBeenCalledTimes(2)
    expect(
      (
        await db.orm.public.GithubPrState.where({
          repoFullName: 'compai/app',
          prNumber: 42,
        }).first()
      )?.state,
    ).toBe('open')
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
