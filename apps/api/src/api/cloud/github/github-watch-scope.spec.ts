import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { unstubAllGlobals } from '@dltech/bun-test-shims'
import {
  ensureUsers,
  prStateRows,
  seedPrState,
  seedRepoHook,
  seedSubscription,
} from '../../../../test/github-seed'
import { REST_FIELDS, prepareDelivery, serviceWith } from '@dltech/atlas-github/testing'
import { seedLinkedPr } from '@dltech/atlas-github/testing'
import { seedTarget } from './github-poll-sweeper.fixture'
import { serviceWith as subscriptionsWith } from './github-subscriptions.fixture'

const repo = 'compai/app'

const checkRunOf = (args: { pullRequests?: number[] } = {}) => ({
  action: 'completed',
  check_run: {
    id: 1,
    name: 'build',
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-11-02T04:25:00Z',
    completed_at: '2026-11-02T04:26:00Z',
    head_sha: 'abc123',
    pull_requests: (args.pullRequests ?? []).map((number) => ({ number })),
    check_suite: { head_branch: 'dennis/add-the-thing' },
  },
  repository: { full_name: repo },
})

const statusOf = (branches: string[] = []) => ({
  branches: branches.map((name) => ({ name })),
  id: 9,
  sha: 'abc123',
  context: 'vercel',
  state: 'success',
  created_at: null,
  updated_at: null,
  repository: { full_name: repo },
})

const pullRequestOf = (branch: string) => ({
  action: 'opened',
  pull_request: {
    number: 42,
    title: 'add the thing',
    html_url: 'https://github.com/compai/app/pull/42',
    state: 'open',
    draft: false,
    merged_at: null,
    updated_at: '2026-11-18T00:00:00Z',
    mergeable: null,
    mergeable_state: 'unknown',
    head: { ref: branch, sha: 'abc123', repo: { full_name: repo } },
    base: { ref: 'main' },
  },
  repository: { full_name: repo },
})

const commitCheckRows = () => db.orm.public.GithubCommitCheck.all()
const outboxRows = () => db.orm.public.GithubPrOutbox.all()
const deliveryRows = () => db.orm.public.GithubPrEventDelivery.all()

const cover = (repoFullName: string) =>
  db.orm.public.GithubAppInstallation.create({
    installationId: 21n,
    accountLogin: repoFullName.split('/')[0] ?? 'compai',
    accountType: 'Organization',
    repos: [repoFullName],
    suspendedAt: null,
  })

describe('delivery watch scope', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  afterEach(() => unstubAllGlobals())

  it('leaves a check_run for a pull request nothing watches untouched', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const readCheckAnnotations = vi.fn(async () => [])
    const { service } = serviceWith({ readPullRequest, readCheckAnnotations })

    await service.handle({ event: 'check_run', payload: checkRunOf({ pullRequests: [42] }) })

    expect(readPullRequest).not.toHaveBeenCalled()
    expect(readCheckAnnotations).not.toHaveBeenCalled()
    expect(await commitCheckRows()).toHaveLength(0)
    expect(await prStateRows()).toHaveLength(0)
    expect(await outboxRows()).toHaveLength(0)
    expect(await deliveryRows()).toHaveLength(0)
  })

  it('processes the same check_run once a live subscription watches the pull request', async () => {
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    const { service } = serviceWith({ readPullRequest: async () => REST_FIELDS })

    await service.handle({ event: 'check_run', payload: checkRunOf({ pullRequests: [42] }) })

    expect(await commitCheckRows()).toHaveLength(1)
  })

  it('processes a check_run for a pull request a session still links after its watch lapsed', async () => {
    await seedLinkedPr({ userId: 'usr-a' })
    const { service } = serviceWith({ readPullRequest: async () => REST_FIELDS })

    await service.handle({ event: 'check_run', payload: checkRunOf({ pullRequests: [42] }) })

    expect(await commitCheckRows()).toHaveLength(1)
  })

  it('processes a status whose sha belongs to a watched pull request', async () => {
    await seedSubscription({ userId: 'usr-a', prNumber: 42 })
    await seedPrState({ headSha: 'abc123', headBranch: 'dennis/add-the-thing' })
    const { service } = serviceWith({ readPullRequest: async () => REST_FIELDS })

    await service.handle({ event: 'status', payload: statusOf() })

    expect(await commitCheckRows()).toHaveLength(1)
  })

  it('skips a status whose sha belongs to no watched pull request', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ readPullRequest })

    await service.handle({
      event: 'status',
      payload: statusOf(['someone/else']),
    })

    expect(readPullRequest).not.toHaveBeenCalled()
    expect(await commitCheckRows()).toHaveLength(0)
    expect(await prStateRows()).toHaveLength(0)
  })

  it('processes a pull_request on a branch a session tracks before any pull request row exists', async () => {
    await seedTarget({ kind: 'head', userId: 'usr-a', branch: 'dennis/feature' })
    const readPullRequest = vi.fn(async () => ({ ...REST_FIELDS, headBranch: 'dennis/feature' }))
    const { service } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' }, readPullRequest })
    await seedRepoHook({ createdBy: 'usr-creator' })

    await service.handle({ event: 'pull_request', payload: pullRequestOf('dennis/feature') })

    expect(readPullRequest).toHaveBeenCalledTimes(1)
    expect(await prStateRows()).toHaveLength(1)
  })

  it('leaves a pull_request on an unwatched branch untouched', async () => {
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({ tokens: { 'usr-creator': 'ghu_creator' }, readPullRequest })

    await service.handle({ event: 'pull_request', payload: pullRequestOf('someone/else') })

    expect(readPullRequest).not.toHaveBeenCalled()
    expect(await prStateRows()).toHaveLength(0)
    expect(await outboxRows()).toHaveLength(0)
  })
})

describe('first fill at watch creation', () => {
  useTestDatabase()

  beforeEach(async () => {
    await ensureUsers('usr_1', 'usr_2')
    await cover(repo)
  })

  afterEach(() => unstubAllGlobals())

  it('reads the pull request on subscribe when nothing watched it before', async () => {
    await seedPrState({
      checksRunning: 3,
      checksPassed: 0,
      pullUpdatedAt: new Date(0),
      updatedAt: new Date(0),
    })
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const service = subscriptionsWith({ token: 'ghu_1', readPullRequest })

    const dto = await service.subscribe({ userId: 'usr_1', repoFullName: repo, prNumber: 42 })

    expect(readPullRequest).toHaveBeenCalledTimes(1)
    expect(dto.state?.mergeable).toBe(true)
    expect((await prStateRows())[0]).toMatchObject({ mergeable: true, headSha: 'abc123' })
  })

  it('keeps the webhook-maintained state when the pull request was already watched', async () => {
    await seedSubscription({ userId: 'usr_2', prNumber: 42 })
    await seedPrState({ checksPassed: 2, updatedAt: new Date() })
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const service = subscriptionsWith({ token: 'ghu_1', readPullRequest })

    const dto = await service.subscribe({ userId: 'usr_1', repoFullName: repo, prNumber: 42 })

    expect(readPullRequest).not.toHaveBeenCalled()
    expect(dto.state?.checksPassed).toBe(2)
  })
})
