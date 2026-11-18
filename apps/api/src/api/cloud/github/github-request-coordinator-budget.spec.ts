import { randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test'
import { createRealRedisService } from '../../../../test/real-redis.fixture'
import { seedPrState, seedSubscription } from '../../../../test/github-seed'
import { seedHeadChecks } from './github-pr-checks.fixture'
import type { RedisService } from '../../../_lib/redis/redis.service'
import { PULL_REQUEST_PAYLOAD } from './github-delivery.fixture'
import { mockGithubHttp, realGithubGraph } from './github-realtime-http.fixture'
import { GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE } from './github-request-coordinator.types'
import { withGithubRequestBudget } from './github-request-budget'
import { RepoAccessChecker } from './github-repo-access'
import { EGithubCallSource } from './github-call-log'
import { githubFetch } from './github-fetch'

describe('shared real HTTP budget for API fills, authorization and worker queue', () => {
  useTestDatabase()
  let redis: RedisService
  let remote: RedisService
  let http: ReturnType<typeof mockGithubHttp>
  let api: ReturnType<typeof realGithubGraph>
  let worker: ReturnType<typeof realGithubGraph>
  beforeAll(async () => {
    redis = await createRealRedisService()
    remote = await createRealRedisService()
  })
  beforeEach(() => {
    setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
    http = mockGithubHttp()
    const prefix = `test:budget:${randomUUID()}:`
    const tokens = { 'usr-owner': 'owner', 'usr-agent': 'agent' }
    api = realGithubGraph({ redis, prefix, tokens })
    worker = realGithubGraph({ redis: remote, prefix, tokens, appBacked: false })
  })
  afterEach(async () => {
    await api.fanout.onModuleDestroy()
    await worker.fanout.onModuleDestroy()
    http.restore()
    setSystemTime()
  })
  afterAll(async () => {
    await redis.onModuleDestroy()
    await remote.onModuleDestroy()
  })
  const access = (store: typeof api.coordinator, token: string) =>
    withGithubRequestBudget({
      store,
      run: () =>
        new RepoAccessChecker(async () => token).require({
          source: EGithubCallSource.RepoAccess,
          userId: token,
          owner: 'compai',
          repo: 'app',
        }),
    })

  it('polls a subscribed PR from closed to open and leaves a PR no subscription names alone', async () => {
    await seedHeadChecks({ headSha: 'abc123', passed: 1 })
    await seedPrState({ state: 'closed', updatedAt: new Date(0) })
    await seedPrState({ prNumber: 77, state: 'open', updatedAt: new Date(0) })
    await seedSubscription({
      userId: 'usr-agent',
      prNumber: 42,
      branch: '#42',
      pollBacked: true,
    })
    await worker.poll.handlePoll()
    expect(
      (await db.orm.public.GithubPrState.first({ repoFullName: 'compai/app', prNumber: 42 }))
        ?.state,
    ).toBe('open')
    expect(http.calls.filter((call) => call.path === '/repos/compai/app/pulls/42')).toHaveLength(1)
    expect(http.calls.some((call) => call.path.endsWith('/pulls/77'))).toBe(false)
    expect(worker.wakes).toEqual([
      { repoFullName: 'compai/app', prNumber: 42, userId: 'usr-agent' },
    ])
    await db.orm.public.GithubPrState.where({ repoFullName: 'compai/app', prNumber: 42 }).update({
      updatedAt: new Date(0),
    })
    const priorCalls = http.calls.length
    await worker.poll.handlePoll()
    expect(http.calls.length).toBe(priorCalls)
  })

  it('paces each credential inside its own minute of the shared budget', async () => {
    for (let number = 1; number <= 30; number += 1)
      await seedSubscription({
        id: `agent-${number}`,
        userId: 'usr-agent',
        prNumber: number,
        branch: `#${number}`,
        pollBacked: true,
      })
    await access(api.coordinator, 'owner')
    const beforeFill = http.calls.length
    await api.delivery.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    expect(http.calls.slice(beforeFill).map((call) => call.path)).toContain('/graphql')
    expect(http.calls.length).toBe(beforeFill + 6)
    await worker.poll.handlePoll()
    const refreshes = http.calls.slice(beforeFill).filter((call) => /\/pulls\/\d+$/.test(call.path))
    expect(refreshes.length).toBeGreaterThan(0)
    expect(refreshes.length).toBeLessThanOrEqual(GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE)
    const numbers = refreshes.map((call) => call.path.split('/').at(-1))
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(
      await db.orm.public.GithubPrState.first({ repoFullName: 'compai/app', prNumber: 1 }),
    ).not.toBeNull()
  })

  it('backs off a failed target, still refreshes a healthy one, and never continually polls a merged entry', async () => {
    for (const [number, id] of [
      [42, 'fail'],
      [43, 'healthy'],
      [44, 'merged'],
    ] as const)
      await seedSubscription({
        id,
        userId: 'usr-agent',
        prNumber: number,
        branch: `#${number}`,
        pollBacked: true,
      })
    await seedPrState({ prNumber: 44, state: 'merged', updatedAt: new Date(0) })
    http.failures.add(42)
    await worker.poll.handlePoll()
    expect(
      (await worker.coordinator.attempt({ key: 'compai/app#42' })).nextAttemptAt,
    ).toBeGreaterThan(Date.now())
    expect(
      await db.orm.public.GithubPrState.first({ repoFullName: 'compai/app', prNumber: 43 }),
    ).not.toBeNull()
    expect(http.calls.some((call) => call.path.endsWith('/pulls/44'))).toBe(false)
    const calls = http.calls.length
    await worker.poll.handlePoll()
    expect(http.calls).toHaveLength(calls)
  })

  it('scopes a provider cooldown to its credential/resource while retaining the shared global HTTP ceiling', async () => {
    const granted = async (store: typeof api.coordinator, token: string) =>
      access(store, token).then(
        () => true,
        () => false,
      )
    http.limited.add('Bearer owner')
    expect(await granted(api.coordinator, 'owner')).toBe(false)
    expect(http.calls).toHaveLength(1)
    http.limited.delete('Bearer owner')
    expect(await granted(worker.coordinator, 'owner')).toBe(false)
    expect(http.calls).toHaveLength(1)
    expect(await granted(worker.coordinator, 'agent')).toBe(true)
    await withGithubRequestBudget({
      store: api.coordinator,
      run: () =>
        githubFetch({
          source: EGithubCallSource.RepoAccess,
          url: 'https://api.github.com/search/repositories',
          init: { headers: { authorization: 'Bearer owner' } },
        }),
    })
    expect(http.calls).toHaveLength(3)
  })

  it('keeps worker targets on another credential progressing when one provider credential is cooling down', async () => {
    await seedSubscription({
      id: 'limited',
      userId: 'usr-owner',
      prNumber: 42,
      branch: '#42',
      pollBacked: true,
    })
    await seedSubscription({
      id: 'healthy',
      userId: 'usr-agent',
      prNumber: 43,
      branch: '#43',
      pollBacked: true,
    })
    http.limited.add('Bearer owner')
    await worker.poll.handlePoll()
    expect(http.calls.filter((call) => call.token === 'Bearer owner')).toHaveLength(1)
    expect(
      http.calls.some((call) => call.token === 'Bearer agent' && call.path.endsWith('/pulls/43')),
    ).toBe(true)
    expect(
      await db.orm.public.GithubPrState.first({ repoFullName: 'compai/app', prNumber: 43 }),
    ).not.toBeNull()
  })
})
