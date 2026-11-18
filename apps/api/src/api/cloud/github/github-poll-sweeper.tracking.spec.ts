import { db, type Row } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import type { RestPullRequest } from './github-pull-request-mapping'
import type { GithubHeadReads } from './github-head-reads'
import { preparePollSweeper, serviceWith } from './github-poll-sweeper.fixture'

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
    prNumber: null,
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

  it('never writes a delivery or inbox row for a tracked head', async () => {
    const head = fakeHeadReads({ pulls: { 'compai/app': [REST_PULL] } })
    const { service } = serviceWith({ tokens: { usr_1: 'ghu_1' }, headReads: head.reads })
    await seedTarget()

    await service.handlePoll()

    expect(await db.orm.public.GithubPrEventDelivery.all()).toHaveLength(0)
    expect(await db.orm.public.GithubWebhookInbox.all()).toHaveLength(0)
  })
})
