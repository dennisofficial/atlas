import { randomUUID } from 'node:crypto'
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
  spyOn,
} from 'bun:test'
import { createRealRedisService } from '../../../../test/real-redis.fixture'
import { waitFor } from '../../../../test/fake-timers'
import { seedPrState } from '../../../../test/github-seed'
import type { RedisService } from '../../../_lib/redis/redis.service'
import { seedLinkedPr } from './github-linked-pr.fixture'
import { cachedPrStates } from './github-linked-prs'
import { mockGithubHttp, realObservationGraph } from './github-observation-http.fixture'

const OBSERVE = [{ repo: 'compai/app', number: 42 }]

describe('shared versioned observation authorization', () => {
  useTestDatabase()
  let first: RedisService
  let second: RedisService
  let http: ReturnType<typeof mockGithubHttp>
  let api: ReturnType<typeof realObservationGraph>
  let remote: ReturnType<typeof realObservationGraph>
  beforeAll(async () => {
    first = await createRealRedisService()
    second = await createRealRedisService()
  })
  beforeEach(async () => {
    http = mockGithubHttp()
    const prefix = `test:shared-acl:${randomUUID()}:`
    const tokens = { 'usr-owner': 'owner', 'usr-other': 'other' }
    api = realObservationGraph({ redis: first, prefix, tokens })
    remote = realObservationGraph({ redis: second, prefix, tokens })
    await seedLinkedPr()
    await seedLinkedPr({ userId: 'usr-other' })
    await seedPrState({ title: 'private cached metadata' })
  })
  afterEach(async () => {
    setSystemTime()
    for (const id of ['lease', 'other', 'cold', 'foreign']) await api.observations.release(id)
    await api.fanout.onModuleDestroy()
    await remote.fanout.onModuleDestroy()
    http.restore()
  })
  afterAll(async () => {
    await first.onModuleDestroy()
    await second.onModuleDestroy()
  })

  it('reuses a current shared proof across cold instances and new lease IDs without another GitHub request', async () => {
    await api.observations.acquire({ id: 'lease', userId: 'usr-owner', observe: OBSERVE })
    const replay = await remote.observations.acquire({
      id: 'cold',
      userId: 'usr-owner',
      observe: OBSERVE,
    })
    expect(replay.available).toBe(true)
    expect(await cachedPrStates(replay.keys)).toHaveLength(1)
    expect(http.calls).toHaveLength(1)
  })

  it('revokes both instances’ leases and cached replay on checked no-access without revoking another user', async () => {
    await api.observations.acquire({ id: 'lease', userId: 'usr-owner', observe: OBSERVE })
    await remote.observations.acquire({ id: 'other', userId: 'usr-owner', observe: OBSERVE })
    await remote.observations.acquire({ id: 'foreign', userId: 'usr-other', observe: OBSERVE })
    setSystemTime(new Date(Date.now() + 90_000))
    http.denied.add('Bearer owner')
    expect(
      await api.observations.acquire({ id: 'lease', userId: 'usr-owner', observe: OBSERVE }),
    ).toMatchObject({ available: false, keys: [] })
    for (const store of [api.observations, remote.observations]) {
      expect(await store.owners({ repoFullName: 'compai/app', prNumber: 42 })).toEqual([
        'usr-other',
      ])
      expect(await store.targets()).toEqual([
        { repoFullName: 'compai/app', prNumber: 42, userIds: ['usr-other'] },
      ])
      const replay = await store.acquire({ id: 'cold', userId: 'usr-owner', observe: OBSERVE })
      expect(replay).toMatchObject({ available: false, keys: [] })
      expect(await cachedPrStates(replay.keys)).toEqual([])
    }
    const outage = spyOn(second.client(), 'get').mockRejectedValue(
      new Error('shared proof cannot be verified'),
    )
    try {
      const replay = await remote.observations.acquire({
        id: 'cold',
        userId: 'usr-owner',
        observe: OBSERVE,
      })
      expect(replay).toMatchObject({ available: false, keys: [] })
      expect(await cachedPrStates(replay.keys)).toEqual([])
    } finally {
      outage.mockRestore()
    }
  })

  it('does not let an older successful in-flight check overwrite a newer shared denial', async () => {
    let complete: (() => void) | undefined
    http.holdAccess(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        }),
    )
    const pending = api.observations.acquire({ id: 'lease', userId: 'usr-owner', observe: OBSERVE })
    await waitFor(() => expect(http.calls).toHaveLength(1))
    http.denied.add('Bearer owner')
    expect(
      await remote.observations.acquire({ id: 'other', userId: 'usr-owner', observe: OBSERVE }),
    ).toMatchObject({ keys: [], available: false })
    if (complete === undefined) throw new Error('missing held authorization request')
    complete()
    const result = await pending
    expect(result).toMatchObject({ keys: [], available: false })
    expect(await cachedPrStates(result.keys)).toEqual([])
    expect(await api.observations.owners({ repoFullName: 'compai/app', prNumber: 42 })).toEqual([])
    expect(await remote.observations.targets()).toEqual([])
  })
})
