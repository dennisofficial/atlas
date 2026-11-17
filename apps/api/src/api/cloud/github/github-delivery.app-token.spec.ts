import { useTestDatabase } from '@dltech/atlas-db/testing'
import { db } from '@dltech/atlas-db'
import { afterEach, beforeEach, describe, expect, it, setSystemTime, vi } from 'bun:test'
import { seedPrState } from '../../../../test/github-seed'
import { EGithubCallSource } from './github-call-log'
import {
  prepareDelivery,
  PULL_REQUEST_PAYLOAD,
  REST_FIELDS,
  seedHook,
  serviceWith,
} from './github-delivery.fixture'
import { fakeGithubApp, syncServiceWith } from './github-app-sync.fixture'
import { GithubInstallationTokens } from './github-installation-tokens'

const seedAppCoverage = (): Promise<unknown> =>
  db.orm.public.GithubAppInstallation.create({
    installationId: 11n,
    accountLogin: 'compai',
    accountType: 'Organization',
    repos: ['compai/app'],
    suspendedAt: null,
  })

const appTokensOver = (): GithubInstallationTokens => {
  const { client, installations } = syncServiceWith()
  return new GithubInstallationTokens(client, installations)
}

const stubMintFailure = (): { restore: () => void; calls: () => number } => {
  const earlier = globalThis.fetch
  const seen: string[] = []
  globalThis.fetch = (async (target: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(
      typeof target === 'string' ? target : target instanceof URL ? target.href : target.url,
    )
    if (url.hostname !== 'api.github.com') return earlier(target, init)
    seen.push(`${init?.method ?? 'GET'} ${url.pathname}`)
    return Response.json({ message: 'server error' }, { status: 500 })
  }) as typeof fetch
  return { restore: () => (globalThis.fetch = earlier), calls: () => seen.length }
}

let github: ReturnType<typeof fakeGithubApp> | undefined
let mintFailure: ReturnType<typeof stubMintFailure> | undefined

afterEach(() => {
  mintFailure?.restore()
  mintFailure = undefined
  github?.restore()
  github = undefined
  setSystemTime()
})

describe('GithubDeliveryService fill credential', () => {
  useTestDatabase()

  beforeEach(prepareDelivery)

  it('fills an App-covered repository on the installation token with no user token at all', async () => {
    github = fakeGithubApp({ installations: [] })
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({
      tokens: {},
      appTokens: appTokensOver(),
      readPullRequest,
    })
    await seedAppCoverage()

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })

    expect(readPullRequest).toHaveBeenCalledWith({
      source: EGithubCallSource.DeliveryFill,
      token: 'inst-11',
      owner: 'compai',
      repo: 'app',
      number: 42,
    })
    expect((await db.orm.public.GithubPrState.first({ prNumber: 42 }))?.checksPassed).toBe(2)
  })

  it('fills a check event on the installation token', async () => {
    github = fakeGithubApp({ installations: [] })
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({
      tokens: {},
      appTokens: appTokensOver(),
      readPullRequest,
    })
    await seedAppCoverage()
    await seedPrState({
      repoFullName: 'compai/app',
      prNumber: 42,
      title: 'add the thing',
      url: 'https://github.com/compai/app/pull/42',
      state: 'open',
      headBranch: 'dennis/add-the-thing',
      headSha: 'abc123',
      headRepoFullName: 'compai/app',
      checksRunning: 0,
      checksPassed: 0,
      checksFailed: 0,
      mergeable: null,
      updatedAt: new Date(),
    })

    await service.handle({
      event: 'check_run',
      payload: {
        action: 'completed',
        check_run: {
          id: 1,
          name: 'build',
          status: 'completed',
          conclusion: 'success',
          started_at: '2026-11-02T04:25:00Z',
          completed_at: '2026-11-02T04:26:00Z',
          head_sha: 'abc123',
          check_suite: { head_branch: 'dennis/add-the-thing' },
        },
        repository: { full_name: 'compai/app' },
      },
    })

    expect(readPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'inst-11', number: 42 }),
    )
  })

  it('keeps the user token for a repository no installation covers', async () => {
    github = fakeGithubApp({ installations: [] })
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      appTokens: appTokensOver(),
      readPullRequest,
    })
    await seedHook({ createdBy: 'usr-creator' })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })

    expect(readPullRequest).toHaveBeenCalledWith(expect.objectContaining({ token: 'ghu_creator' }))
    expect(github.calls).toEqual([])
  })

  it('falls back to the user token when the installation token cannot be minted', async () => {
    mintFailure = stubMintFailure()
    const readPullRequest = vi.fn(async () => REST_FIELDS)
    const { service } = serviceWith({
      tokens: { 'usr-creator': 'ghu_creator' },
      appTokens: appTokensOver(),
      readPullRequest,
    })
    await seedAppCoverage()
    await seedHook({ createdBy: 'usr-creator' })

    await service.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })

    expect(readPullRequest).toHaveBeenCalledWith(expect.objectContaining({ token: 'ghu_creator' }))
    expect(mintFailure.calls()).toBe(1)
  })
})
