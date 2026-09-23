import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeGithubDb } = await import('../../../../test/fake-github-db.js')
  return { db: fakeGithubDb().db as unknown as PrismaClient }
})

import { fakeGithubDb } from '../../../../test/fake-github-db'
import type { GithubInstallationReads } from './github-installation-reads'
import { GithubPrWebhookService } from './github-webhook.service'

const fake = fakeGithubDb()

const PULL_REQUEST_PAYLOAD = {
  action: 'opened',
  pull_request: {
    number: 42,
    title: 'add the thing',
    html_url: 'https://github.com/compai/app/pull/42',
    state: 'open',
    draft: false,
    merged_at: null,
    head: { ref: 'dennis/add-the-thing', sha: 'abc123' },
  },
  repository: { full_name: 'compai/app' },
}

const SYNCED_FIELDS = {
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  checksRunning: 1,
  checksPassed: 2,
  checksFailed: 0,
  mergeable: true,
  mergeableState: 'clean',
}

function serviceWith(reads: Partial<GithubInstallationReads>): GithubPrWebhookService {
  return new GithubPrWebhookService(reads as GithubInstallationReads)
}

describe('GithubPrWebhookService', () => {
  beforeEach(() => fake.reset())

  it('persists every delivery for stream replay', async () => {
    const service = serviceWith({})
    const outcome = await service.handle({
      event: 'check_suite',
      deliveryId: 'del-1',
      payload: { check_suite: { head_sha: 'abc', head_branch: 'main' }, repository: { full_name: 'compai/app' } },
    })

    expect(outcome.persisted).toBe(true)
    expect(fake.events).toHaveLength(1)
    expect(fake.events[0]).toMatchObject({
      id: 'del-1',
      event: 'check_suite',
      repoFullName: 'compai/app',
      branch: 'main',
    })
  })

  it('drops a redelivered delivery id rather than double-applying it', async () => {
    const readPullRequest = vi.fn(async () => SYNCED_FIELDS)
    const service = serviceWith({ readPullRequest })

    await service.handle({ event: 'pull_request', deliveryId: 'del-1', payload: PULL_REQUEST_PAYLOAD })
    const again = await service.handle({
      event: 'pull_request',
      deliveryId: 'del-1',
      payload: PULL_REQUEST_PAYLOAD,
    })

    expect(again.persisted).toBe(false)
    expect(fake.events).toHaveLength(1)
  })

  it('a pull_request delivery refreshes the cached PR from one installation read', async () => {
    const readPullRequest = vi.fn(async () => SYNCED_FIELDS)
    const service = serviceWith({ readPullRequest })

    const outcome = await service.handle({
      event: 'pull_request',
      deliveryId: 'del-1',
      payload: PULL_REQUEST_PAYLOAD,
    })

    expect(outcome.handled).toBe(true)
    expect(readPullRequest).toHaveBeenCalledWith({ owner: 'compai', repo: 'app', number: 42 })
    expect(fake.pullRequests).toHaveLength(1)
    expect(fake.pullRequests[0]).toMatchObject({
      repoFullName: 'compai/app',
      number: 42,
      mergeable: true,
      checksPassed: 2,
    })
  })

  it('upserts over the existing row on the next delivery of the same PR', async () => {
    const service = serviceWith({
      readPullRequest: vi.fn(async () => ({ ...SYNCED_FIELDS, checksPassed: 3 })),
    })
    await service.handle({ event: 'pull_request', deliveryId: 'del-1', payload: PULL_REQUEST_PAYLOAD })
    await service.handle({ event: 'pull_request', deliveryId: 'del-2', payload: PULL_REQUEST_PAYLOAD })

    expect(fake.pullRequests).toHaveLength(1)
    expect(fake.pullRequests[0]?.checksPassed).toBe(3)
  })

  it('records ping without touching the cache', async () => {
    const readPullRequest = vi.fn()
    const service = serviceWith({ readPullRequest })

    const outcome = await service.handle({ event: 'ping', deliveryId: 'del-1', payload: {} })

    expect(outcome.handled).toBe(true)
    expect(readPullRequest).not.toHaveBeenCalled()
    expect(fake.pullRequests).toHaveLength(0)
  })

  const seedCachedPullRequest = async (service: GithubPrWebhookService): Promise<void> => {
    await service.handle({ event: 'pull_request', deliveryId: 'del-seed', payload: PULL_REQUEST_PAYLOAD })
    const row = fake.pullRequests[0]
    if (row === undefined) throw new Error('seed did not cache a pull request')
    row.updatedAt = new Date(Date.now() - 60_000)
  }

  it('a check_suite delivery refreshes the cached PR on its branch', async () => {
    const readPullRequest = vi.fn(async () => ({ ...SYNCED_FIELDS, checksRunning: 4 }))
    const service = serviceWith({ readPullRequest })
    await seedCachedPullRequest(service)
    readPullRequest.mockClear()

    const outcome = await service.handle({
      event: 'check_suite',
      deliveryId: 'del-2',
      payload: {
        check_suite: { head_sha: 'abc123', head_branch: 'dennis/add-the-thing' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(outcome.handled).toBe(true)
    expect(readPullRequest).toHaveBeenCalledWith({ owner: 'compai', repo: 'app', number: 42 })
    expect(fake.pullRequests[0]?.checksRunning).toBe(4)
  })

  it('a check_run delivery refreshes the cached PR by head sha', async () => {
    const readPullRequest = vi.fn(async () => SYNCED_FIELDS)
    const service = serviceWith({ readPullRequest })
    await seedCachedPullRequest(service)
    readPullRequest.mockClear()

    await service.handle({
      event: 'check_run',
      deliveryId: 'del-2',
      payload: {
        check_run: { head_sha: 'abc123', check_suite: { head_branch: 'dennis/add-the-thing' } },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(readPullRequest).toHaveBeenCalledWith({ owner: 'compai', repo: 'app', number: 42 })
  })

  it('a push delivery refreshes the cached PR whose head branch was pushed', async () => {
    const readPullRequest = vi.fn(async () => SYNCED_FIELDS)
    const service = serviceWith({ readPullRequest })
    await seedCachedPullRequest(service)
    readPullRequest.mockClear()

    await service.handle({
      event: 'push',
      deliveryId: 'del-2',
      payload: { ref: 'refs/heads/dennis/add-the-thing', repository: { full_name: 'compai/app' } },
    })

    expect(readPullRequest).toHaveBeenCalledWith({ owner: 'compai', repo: 'app', number: 42 })
  })

  it('ignores check events for branches with no cached PR', async () => {
    const readPullRequest = vi.fn(async () => SYNCED_FIELDS)
    const service = serviceWith({ readPullRequest })
    await seedCachedPullRequest(service)
    readPullRequest.mockClear()

    await service.handle({
      event: 'check_suite',
      deliveryId: 'del-2',
      payload: {
        check_suite: { head_sha: 'other', head_branch: 'someone/else' },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('coalesces a check storm onto a row the last delivery just refreshed', async () => {
    const readPullRequest = vi.fn(async () => SYNCED_FIELDS)
    const service = serviceWith({ readPullRequest })
    await service.handle({ event: 'pull_request', deliveryId: 'del-1', payload: PULL_REQUEST_PAYLOAD })
    readPullRequest.mockClear()

    await service.handle({
      event: 'check_run',
      deliveryId: 'del-2',
      payload: { check_run: { head_sha: 'abc123' }, repository: { full_name: 'compai/app' } },
    })

    expect(readPullRequest).not.toHaveBeenCalled()
  })
})
