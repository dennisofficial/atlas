import { randomUUID } from 'node:crypto'
import { db } from '@dltech/atlas-db'
import { seedThread, useTestDatabase } from '@dltech/atlas-db/testing'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  spyOn,
} from 'bun:test'
import { createRealRedisService } from '../../../../test/real-redis.fixture'
import { waitFor } from '../../../../test/fake-timers'
import type { RedisService } from '../../../_lib/redis/redis.service'
import { seedPrState } from '../../../../test/github-seed'
import { seedLinkedPr } from './github-linked-pr.fixture'
import { cachedPrStates } from './github-linked-prs'
import { mockGithubHttp, realObservationGraph } from './github-observation-http.fixture'
import { OBSERVATION_TTL_MS } from './github-observation.types'

describe('authorized expiring observation leases over real Redis and Postgres', () => {
  useTestDatabase()
  let redis: RedisService
  let remote: RedisService
  let http: ReturnType<typeof mockGithubHttp>
  let api: ReturnType<typeof realObservationGraph>
  let worker: ReturnType<typeof realObservationGraph>
  let prefix: string
  let tokens: Record<string, string>
  beforeAll(async () => {
    redis = await createRealRedisService()
    remote = await createRealRedisService()
  })
  beforeEach(() => {
    http = mockGithubHttp()
    prefix = `test:observe:${randomUUID()}:`
    tokens = { 'usr-owner': 'owner', 'usr-other': 'other' }
    api = realObservationGraph({ redis, prefix, tokens })
    worker = realObservationGraph({ redis: remote, prefix, tokens })
  })
  afterEach(async () => {
    setSystemTime()
    await api.observations.release('lease')
    await api.observations.release('other')
    await api.fanout.onModuleDestroy()
    await worker.fanout.onModuleDestroy()
    http.restore()
  })
  afterAll(async () => {
    await redis.onModuleDestroy()
    await remote.onModuleDestroy()
  })
  const acquire = () =>
    api.observations.acquire({
      id: 'lease',
      userId: 'usr-owner',
      observe: [{ repo: 'CompAI/App', number: 42 }],
    })

  it('authorizes owned reference links with the observer credential and indexes cross-instance delivery until release', async () => {
    await seedLinkedPr()
    await seedThread({ db, id: 'reference', userId: 'usr-owner' })
    await db.orm.public.Thread.where({ id: 'reference' }).update({
      forkMode: 'reference',
      parentThreadId: 'thr-usr-owner',
      forkSeq: 1,
    })
    expect(await acquire()).toMatchObject({
      available: true,
      keys: [{ repoFullName: 'compai/app', prNumber: 42 }],
    })
    expect(http.calls).toEqual([{ path: '/repos/compai/app', token: 'Bearer owner' }])
    expect(await worker.observations.owners({ repoFullName: 'COMPAI/APP', prNumber: 42 })).toEqual([
      'usr-owner',
    ])
    expect(await worker.observations.targets()).toEqual([
      { repoFullName: 'compai/app', prNumber: 42, userIds: ['usr-owner'] },
    ])
    const ttl = await redis.client().pttl(`${prefix}lease:lease`)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(OBSERVATION_TTL_MS)
    await api.observations.release('lease')
    expect(await worker.observations.owners({ repoFullName: 'compai/app', prNumber: 42 })).toEqual(
      [],
    )
  })

  it('expires crash-abandoned leases and never uses global key enumeration', async () => {
    await seedLinkedPr()
    await acquire()
    const keys = spyOn(remote.client(), 'keys')
    const scan = spyOn(remote.client(), 'scan')
    setSystemTime(new Date(Date.now() + OBSERVATION_TTL_MS + 1))
    expect(await worker.observations.targets()).toEqual([])
    expect(await worker.observations.owners({ repoFullName: 'compai/app', prNumber: 42 })).toEqual(
      [],
    )
    expect(keys).not.toHaveBeenCalled()
    expect(scan).not.toHaveBeenCalled()
    keys.mockRestore()
    scan.mockRestore()
  })

  it('rejects forged persisted links without the observer token or repository access despite another authorized owner and cached private state', async () => {
    await seedLinkedPr()
    await seedLinkedPr({ userId: 'usr-other' })
    await seedPrState({ title: 'private metadata' })
    await api.observations.acquire({
      id: 'other',
      userId: 'usr-other',
      observe: [{ repo: 'compai/app', number: 42 }],
    })
    delete tokens['usr-owner']
    expect(await acquire()).toMatchObject({ available: false, keys: [] })
    tokens['usr-owner'] = 'denied'
    http.denied.add('Bearer denied')
    expect(await acquire()).toMatchObject({ available: false, keys: [] })
    expect(await worker.observations.owners({ repoFullName: 'compai/app', prNumber: 42 })).toEqual([
      'usr-other',
    ])
    expect(http.calls.some((call) => call.token === 'Bearer denied')).toBe(true)
  })

  it('invalidates an authorization immediately when the observer credential changes or disconnects, without network calls on delivery', async () => {
    await seedLinkedPr()
    await acquire()
    const calls = http.calls.length
    tokens['usr-owner'] = 'new-denied'
    http.denied.add('Bearer new-denied')
    expect(await worker.observations.owners({ repoFullName: 'compai/app', prNumber: 42 })).toEqual(
      [],
    )
    expect(http.calls).toHaveLength(calls)
    expect(await acquire()).toMatchObject({ available: false, keys: [] })
    delete tokens['usr-owner']
    expect(await acquire()).toMatchObject({ keys: [] })
  })

  it('keeps bounded authorization proofs usable for cached replay on Redis write outage, reports failure and recovers', async () => {
    await seedLinkedPr()
    await seedPrState()
    await acquire()
    const calls = http.calls.length
    const outage = spyOn(redis.client(), 'eval').mockRejectedValue(
      new Error('test coordinator outage'),
    )
    const unavailable = await acquire()
    expect(unavailable.available).toBe(false)
    expect(await cachedPrStates(unavailable.keys)).toHaveLength(1)
    expect(http.calls).toHaveLength(calls)
    outage.mockRestore()
    expect((await acquire()).available).toBe(true)
    expect(await worker.observations.targets()).toHaveLength(1)
  })

  it('aborts in-flight repository authorization and spends no further HTTP calls after cancellation', async () => {
    await seedLinkedPr()
    await seedLinkedPr({ repo: 'compai/next' })
    http.holdAccess(
      ({ signal }) =>
        new Promise<void>((_resolve, reject) => {
          if (signal === undefined || signal === null)
            throw new Error('missing caller abort signal')
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    const controller = new AbortController()
    const pending = api.observations.acquire({
      id: 'lease',
      userId: 'usr-owner',
      observe: [
        { repo: 'compai/app', number: 42 },
        { repo: 'compai/next', number: 42 },
      ],
      signal: controller.signal,
    })
    await waitFor(() => expect(http.calls).toHaveLength(1))
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(http.calls).toHaveLength(1)
    expect(await worker.observations.targets()).toEqual([])
  })

  it('returns no cached replay keys if the observer credential disappears while repository access is in flight', async () => {
    await seedLinkedPr()
    await seedLinkedPr({ repo: 'compai/next' })
    await seedPrState({ title: 'private' })
    let complete: (() => void) | undefined
    http.holdAccess(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        }),
    )
    const pending = api.observations.acquire({
      id: 'lease',
      userId: 'usr-owner',
      observe: [
        { repo: 'compai/app', number: 42 },
        { repo: 'compai/next', number: 42 },
      ],
    })
    await waitFor(() => expect(http.calls).toHaveLength(1))
    delete tokens['usr-owner']
    if (complete === undefined) throw new Error('missing held repository authorization')
    complete()
    const result = await pending
    expect(result).toMatchObject({ available: false, keys: [] })
    expect(await cachedPrStates(result.keys)).toEqual([])
    expect(await worker.observations.targets()).toEqual([])
    expect(http.calls).toHaveLength(1)
  })

  it('normalizes legacy mixed-case cache rows without leaking cross-product repo/number matches', async () => {
    await seedLinkedPr()
    await seedLinkedPr({ repo: 'compai/elsewhere', number: 7 })
    await seedPrState({ repoFullName: 'CompAI/App' })
    await seedPrState({ repoFullName: 'compai/app', prNumber: 7, title: 'not owned' })
    const lease = await acquire()
    expect(await cachedPrStates(lease.keys)).toMatchObject([
      { repoFullName: 'compai/app', prNumber: 42 },
    ])
  })
})
