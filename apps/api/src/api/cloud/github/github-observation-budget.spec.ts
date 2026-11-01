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
import type { RedisService } from '../../../_lib/redis/redis.service'
import { PULL_REQUEST_PAYLOAD } from './github-delivery.fixture'
import { seedLinkedPr } from './github-linked-pr.fixture'
import { mockGithubHttp, realObservationGraph } from './github-observation-http.fixture'
import {
  GITHUB_HTTP_BUDGET_PER_MINUTE,
  GITHUB_AUTH_HTTP_BUDGET_PER_MINUTE,
  GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE,
} from './github-observation.types'
import { withGithubRequestBudget } from './github-request-budget'
import { RepoAccessChecker } from './github-repo-access'
import { EGithubCallSource } from './github-call-log'
import { githubFetch } from './github-fetch'

describe('shared real HTTP budget for API fills, authorization and worker queue', () => {
  useTestDatabase()
  let redis: RedisService
  let remote: RedisService
  let http: ReturnType<typeof mockGithubHttp>
  let api: ReturnType<typeof realObservationGraph>
  let worker: ReturnType<typeof realObservationGraph>
  beforeAll(async () => {
    redis = await createRealRedisService()
    remote = await createRealRedisService()
  })
  beforeEach(() => {
    setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
    http = mockGithubHttp()
    const prefix = `test:budget:${randomUUID()}:`
    const tokens = { 'usr-owner': 'owner', 'usr-agent': 'agent' }
    api = realObservationGraph({ redis, prefix, tokens })
    worker = realObservationGraph({ redis: remote, prefix, tokens, appBacked: false })
  })
  afterEach(async () => {
    await api.observations.release('visible')
    await api.fanout.onModuleDestroy()
    await worker.fanout.onModuleDestroy()
    http.restore()
    setSystemTime()
  })
  afterAll(async () => {
    await redis.onModuleDestroy()
    await remote.onModuleDestroy()
  })
  const acquire = (numbers: number[]) =>
    api.observations.acquire({
      id: 'visible',
      userId: 'usr-owner',
      observe: numbers.map((number) => ({ repo: 'compai/app', number })),
    })

  it('deduplicates the agent and observer union, polls closed→open without agent subscriptions, and ignores all invisible history', async () => {
    await seedLinkedPr()
    await seedLinkedPr({ number: 77 })
    await seedPrState({ state: 'closed', updatedAt: new Date(0) })
    await seedPrState({ prNumber: 77, state: 'open', updatedAt: new Date(0) })
    await acquire([42])
    await worker.poll.handlePoll()
    expect(
      (await db.orm.public.GithubPrState.first({ repoFullName: 'compai/app', prNumber: 42 }))
        ?.state,
    ).toBe('open')
    expect(http.calls.filter((call) => call.path === '/repos/compai/app/pulls/42')).toHaveLength(1)
    expect(http.calls.some((call) => call.path.endsWith('/pulls/77'))).toBe(false)
    expect(await db.orm.public.GithubSubscription.all()).toEqual([])
    expect(await db.orm.public.GithubPrEvent.all()).toEqual([])
    expect(worker.wakes).toEqual([])
    await seedSubscription({ userId: 'usr-agent', pollBacked: true })
    await db.orm.public.GithubPrState.where({ repoFullName: 'compai/app', prNumber: 42 }).update({
      updatedAt: new Date(0),
    })
    await worker.observations.recordAttempt({ key: 'compai/app#42', failed: false })
    const priorCalls = http.calls.length
    await worker.poll.handlePoll()
    expect(http.calls.length).toBe(priorCalls)
  })

  it('charges actual API delivery fills and worker/auth/hook HTTP attempts against one cross-instance ceiling', async () => {
    for (let number = 1; number <= 30; number += 1) {
      await seedLinkedPr({ number })
      await seedSubscription({
        id: `agent-${number}`,
        userId: 'usr-agent',
        prNumber: number,
        branch: `#${number}`,
        pollBacked: true,
      })
    }
    await acquire(Array.from({ length: 30 }, (_, index) => index + 1))
    const beforeFill = http.calls.length
    await api.delivery.handle({ event: 'pull_request', payload: PULL_REQUEST_PAYLOAD })
    expect(http.calls.length).toBe(beforeFill + 3)
    await worker.poll.handlePoll()
    expect(http.calls.length).toBe(GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE + 1)
    for (let index = 1; index < GITHUB_AUTH_HTTP_BUDGET_PER_MINUTE; index += 1) {
      await withGithubRequestBudget({
        store: api.observations,
        run: () =>
          githubFetch({
            source: EGithubCallSource.RepoAccess,
            url: 'https://api.github.com/repos/compai/app',
            init: { headers: { authorization: 'Bearer owner' } },
          }),
      })
    }
    expect(http.calls.length).toBe(GITHUB_HTTP_BUDGET_PER_MINUTE)
    expect(http.calls.some((call) => call.path.endsWith('/hooks'))).toBe(true)
    const refreshes = http.calls.filter((call) => /\/pulls\/\d+$/.test(call.path))
    const numbers = refreshes.map((call) => call.path.split('/').at(-1))
    expect(new Set(numbers).size).toBe(numbers.length)
    await api.delivery.handle({
      event: 'pull_request',
      payload: {
        ...PULL_REQUEST_PAYLOAD,
        pull_request: {
          ...PULL_REQUEST_PAYLOAD.pull_request,
          title: 'payload survives budget exhaustion',
        },
      },
    })
    expect(http.calls).toHaveLength(GITHUB_HTTP_BUDGET_PER_MINUTE)
    expect(
      (await db.orm.public.GithubPrState.first({ repoFullName: 'compai/app', prNumber: 42 }))
        ?.title,
    ).toBe('payload survives budget exhaustion')
  })

  it('backs off failed old targets, still refreshes healthy targets, and never continually polls merged entries', async () => {
    await seedLinkedPr()
    await seedLinkedPr({ number: 43 })
    await seedLinkedPr({ number: 44 })
    await acquire([42, 43, 44])
    await seedPrState({ prNumber: 44, state: 'merged', updatedAt: new Date(0) })
    http.failures.add(42)
    await worker.poll.handlePoll()
    expect(
      (await worker.observations.attempt({ key: 'compai/app#42' })).nextAttemptAt,
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
    const access = (token: string, store: typeof api.observations) =>
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
    http.limited.add('Bearer owner')
    await expect(access('owner', api.observations)).rejects.toThrow()
    expect(http.calls).toHaveLength(1)
    http.limited.delete('Bearer owner')
    await expect(access('owner', worker.observations)).rejects.toThrow()
    expect(http.calls).toHaveLength(1)
    await expect(access('agent', worker.observations)).resolves.toBe(true)
    await withGithubRequestBudget({
      store: api.observations,
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

  it('rotates bounded authorization work past denied repositories without starving an existing agent target', async () => {
    const observe = Array.from({ length: 14 }, (_, index) => ({
      repo: `compai/aa-denied-${index.toString().padStart(2, '0')}`,
      number: 42,
    }))
    observe.push({ repo: 'compai/zz-healthy', number: 42 })
    for (const target of observe) await seedLinkedPr({ repo: target.repo })
    for (const target of observe.slice(0, -1)) http.deniedRepos.add(target.repo)
    await seedSubscription({
      id: 'agent-progress',
      userId: 'usr-agent',
      prNumber: 91,
      branch: '#91',
      pollBacked: true,
    })
    let healthy = false
    for (let attempt = 0; attempt < 6 && !healthy; attempt += 1) {
      const result = await api.observations.acquire({ id: 'visible', userId: 'usr-owner', observe })
      expect(result.available).toBe(false)
      healthy = result.keys.some((key) => key.repoFullName === 'compai/zz-healthy')
      await worker.poll.handlePoll()
      expect(
        await db.orm.public.GithubPrState.first({ repoFullName: 'compai/app', prNumber: 91 }),
      ).not.toBeNull()
      setSystemTime(new Date(Date.now() + 60_000))
    }
    expect(healthy).toBe(true)
    expect(http.calls.filter((call) => call.path === '/repos/compai/aa-denied-00')).toHaveLength(2)
  })

  it('does not retain observational hook ownership after lease release', async () => {
    await seedLinkedPr()
    await acquire([42])
    http.allowHooks()
    await worker.poll.handlePoll()
    await api.observations.release('visible')
    await worker.poll.handlePoll()
    expect(
      (await db.orm.public.GithubRepoHook.first({ repoFullName: 'compai/app' }))?.idleSince,
    ).not.toBeNull()
  })
})
