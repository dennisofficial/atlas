import { ForbiddenException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeGithubDb } = await import('../../../../test/fake-github-db.js')
  return { db: fakeGithubDb().db as unknown as PrismaClient }
})

import { fakeGithubDb } from '../../../../test/fake-github-db'
import type { GithubInstallationReads } from './github-installation-reads'
import type { GithubService } from './github.service'
import { PullRequestsService } from './pull-requests.service'

const fake = fakeGithubDb()

const SYNCED = {
  title: 'add the thing',
  url: 'https://github.com/compai/app/pull/42',
  state: 'open',
  headBranch: 'dennis/add-the-thing',
  headSha: 'abc123',
  checksRunning: 0,
  checksPassed: 3,
  checksFailed: 0,
  mergeable: true,
  mergeableState: 'clean',
}

const okFetch = async () => new Response('{}', { status: 200 })

function serviceWith(args: {
  token?: string
  reads?: Partial<GithubInstallationReads>
  fetchImpl?: typeof fetch
}): PullRequestsService {
  const github = {
    findToken: async () => args.token,
  } as unknown as GithubService
  vi.stubGlobal('fetch', args.fetchImpl ?? okFetch)
  return new PullRequestsService(github, args.reads as GithubInstallationReads)
}

describe('PullRequestsService', () => {
  beforeEach(() => fake.reset())
  afterEach(() => vi.unstubAllGlobals())

  it('answers from the cache without touching github when the row is fresh', async () => {
    const readPullRequest = vi.fn()
    const service = serviceWith({ token: 'ghu_1', reads: { readPullRequest } })
    fake.pullRequests.push({
      repoFullName: 'compai/app',
      number: 42,
      ...SYNCED,
      createdAt: new Date(),
      updatedAt: new Date('2026-09-21T20:00:00Z'),
    })

    const dto = await service.readByBranch({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      branch: 'dennis/add-the-thing',
    })

    expect(dto).toMatchObject({
      number: 42,
      state: 'open',
      checks: { running: 0, passed: 3, failed: 0 },
      mergeable: true,
    })
    expect(readPullRequest).not.toHaveBeenCalled()
  })

  it('fills the cache on a miss before answering', async () => {
    const service = serviceWith({
      token: 'ghu_1',
      reads: {
        findOpenPullRequest: async () => ({ number: 42 }),
        readPullRequest: async () => SYNCED,
      },
    })

    const dto = await service.readByBranch({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      branch: 'dennis/add-the-thing',
    })

    expect(dto?.number).toBe(42)
    expect(fake.pullRequests).toHaveLength(1)
  })

  it('answers null when no open PR carries the branch', async () => {
    const service = serviceWith({
      token: 'ghu_1',
      reads: { findOpenPullRequest: async () => null },
    })

    const dto = await service.readByBranch({
      userId: 'usr_1',
      repoFullName: 'compai/app',
      branch: 'nobody/branch',
    })

    expect(dto).toBeNull()
    expect(fake.pullRequests).toHaveLength(0)
  })

  it('refuses a repo the caller cannot read on github', async () => {
    const denied = async () => new Response('{}', { status: 404 })
    const service = serviceWith({ token: 'ghu_1', reads: {}, fetchImpl: denied as typeof fetch })

    await expect(
      service.readByBranch({ userId: 'usr_1', repoFullName: 'compai/app', branch: 'x/y' }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('reads a 401 from github as an expired token and says to reconnect', async () => {
    const rejected = async () => new Response('{}', { status: 401 })
    const service = serviceWith({ token: 'ghu_dead', reads: {}, fetchImpl: rejected as typeof fetch })

    await expect(
      service.readByBranch({ userId: 'usr_1', repoFullName: 'compai/app', branch: 'x/y' }),
    ).rejects.toThrow(/reconnect github/)
  })

  it('refuses callers who never connected github', async () => {
    const service = serviceWith({ reads: {} })

    await expect(
      service.readByBranch({ userId: 'usr_1', repoFullName: 'compai/app', branch: 'x/y' }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
