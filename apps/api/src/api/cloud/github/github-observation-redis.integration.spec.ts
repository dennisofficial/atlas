import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from 'bun:test'
import {
  realRedisObservations,
  type RedisObservationFixture,
} from './github-observation-redis.integration.fixture'

describe('RedisObservationAdapter over independent real Redis connections', () => {
  let fixture: RedisObservationFixture
  beforeEach(async () => {
    fixture = await realRedisObservations()
  })
  afterEach(async () => {
    setSystemTime()
    await fixture?.dispose()
  })

  it('shares writes, renewals, changed target indexes and removals across instances', async () => {
    expect(fixture.services.first.client()).not.toBe(fixture.services.second.client())
    const lease = fixture.lease({ id: 'shared', ttlMs: 1000 })
    await fixture.first.write(lease)
    expect(await fixture.second.read(lease.id)).toEqual(lease)
    expect(await fixture.second.entries({ repoFullName: 'owner/repo', prNumber: 42 })).toEqual([
      lease,
    ])
    const renewed = fixture.lease({
      id: lease.id,
      ttlMs: 10_000,
      keys: [{ repoFullName: 'owner/renewed', prNumber: 7 }],
    })
    await fixture.second.write(renewed)
    expect(await fixture.first.read(lease.id)).toEqual(renewed)
    expect(
      await fixture.services.first.client().pttl(fixture.key(`lease:${lease.id}`)),
    ).toBeGreaterThan(1000)
    expect(await fixture.first.entries({ repoFullName: 'owner/repo' })).toEqual([])
    expect(await fixture.first.entries({ repoFullName: 'owner/repo', prNumber: 42 })).toEqual([])
    expect(await fixture.first.entries({ repoFullName: 'owner/renewed' })).toEqual([renewed])
    await fixture.first.remove(lease.id)
    await fixture.second.remove(lease.id)
    expect(await fixture.second.read(lease.id)).toBeUndefined()
    expect(await fixture.second.entries()).toEqual([])
    expect(await fixture.second.entries({ repoFullName: 'owner/renewed', prNumber: 7 })).toEqual([])
  })

  it('hard-expires abandoned lease keys and cleans their active and repository indexes', async () => {
    const expired = fixture.lease({ id: 'expired', ttlMs: 100 })
    const survivor = fixture.lease({
      id: 'survivor',
      keys: [{ repoFullName: 'owner/repo', prNumber: 7 }],
    })
    await fixture.first.write(expired)
    await fixture.second.write(survivor)
    await Bun.sleep(180)
    expect(await fixture.services.second.client().exists(fixture.key('lease:expired'))).toBe(0)
    expect(await fixture.second.read(expired.id)).toBeUndefined()
    expect(await fixture.first.entries()).toEqual([survivor])
    expect(await fixture.second.entries({ repoFullName: 'owner/repo' })).toEqual([survivor])
    expect(await fixture.second.entries({ repoFullName: 'owner/repo', prNumber: 42 })).toEqual([])
    expect(
      await fixture.services.first.client().zscore(fixture.key('active'), expired.id),
    ).toBeNull()
    expect(
      await fixture.services.first.client().zscore(fixture.key('repo:owner/repo'), expired.id),
    ).toBeNull()
  })

  it('does not shorten shared active, repo or PR index lifetimes when writing a shorter lease', async () => {
    const survivor = fixture.lease({ id: 'long-lived' })
    const expired = fixture.lease({ id: 'short-lived', ttlMs: 100 })
    await fixture.first.write(survivor)
    await fixture.second.write(expired)
    await Bun.sleep(180)
    expect(await fixture.first.read(survivor.id)).toEqual(survivor)
    const indexes = await Promise.all([
      fixture.second.entries(),
      fixture.first.entries({ repoFullName: 'owner/repo' }),
      fixture.second.entries({ repoFullName: 'owner/repo', prNumber: 42 }),
    ])
    expect(indexes).toEqual([[survivor], [survivor], [survivor]])
  })

  it('prunes expired scores from touched indexes during writes without any lookup', async () => {
    const expired = fixture.lease({ id: 'crashed-writer', ttlMs: 100 })
    const live = fixture.lease({ id: 'renewing-writer' })
    await fixture.first.write(expired)
    await fixture.second.write(live)
    await Bun.sleep(180)
    await fixture.first.write(fixture.lease({ id: live.id }))
    for (const suffix of ['active', 'repo:owner/repo', 'pr:owner/repo#42']) {
      expect(await fixture.services.second.client().zrange(fixture.key(suffix), '0', '-1')).toEqual(
        [live.id],
      )
    }
  })

  it('uses complete repo and PR indexes without global KEYS or SCAN enumeration', async () => {
    const leases = Array.from({ length: 140 }, (_, index) =>
      fixture.lease({ id: `recipient-${index}` }),
    )
    const sameRepo = fixture.lease({ keys: [{ repoFullName: 'owner/repo', prNumber: 7 }] })
    const unrelated = fixture.lease({ keys: [{ repoFullName: 'owner/elsewhere', prNumber: 42 }] })
    await Promise.all([...leases, sameRepo, unrelated].map((lease) => fixture.first.write(lease)))
    const spies = [fixture.services.first, fixture.services.second].flatMap((service) => [
      spyOn(service.client(), 'keys'),
      spyOn(service.client(), 'scan'),
    ])
    try {
      const repo = await fixture.second.entries({ repoFullName: 'owner/repo' })
      const pr = await fixture.first.entries({ repoFullName: 'owner/repo', prNumber: 42 })
      expect(repo.map((lease) => lease.id).sort()).toEqual(
        [...leases, sameRepo].map((lease) => lease.id).sort(),
      )
      expect(pr.map((lease) => lease.id).sort()).toEqual(leases.map((lease) => lease.id).sort())
      expect(await fixture.second.entries({ repoFullName: 'owner/missing' })).toEqual([])
      expect((await fixture.second.entries()).length).toBeLessThanOrEqual(128)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  it('shares a fair global cursor over more than 128 distinct targets while bounding worker batches', async () => {
    const leases = Array.from({ length: 257 }, (_, index) =>
      fixture.lease({
        id: `target-${index}`,
        keys: [{ repoFullName: 'owner/repo', prNumber: index + 1 }],
      }),
    )
    await Promise.all(leases.map((lease) => fixture.first.write(lease)))
    const [first, second] = await Promise.all([fixture.first.entries(), fixture.second.entries()])
    expect(first).toHaveLength(128)
    expect(second).toHaveLength(128)
    expect(new Set([...first, ...second].map((lease) => lease.id)).size).toBe(256)
    const third = await fixture.second.entries()
    expect(third.length).toBeGreaterThan(0)
    expect(third.length).toBeLessThanOrEqual(128)
    const seen = [...first, ...second, ...third]
    expect([...new Set(seen.map((lease) => lease.id))].sort()).toEqual(
      leases.map((lease) => lease.id).sort(),
    )
    expect(new Set(seen.flatMap((lease) => lease.keys.map((key) => key.prNumber))).size).toBe(257)
  })

  it('atomically shares one 60-request minute ceiling across simultaneous credential and instance takes', async () => {
    setSystemTime(new Date('2035-01-01T00:00:00.000Z'))
    const identities = [fixture.identity('agent'), fixture.identity('observer')]
    const accepted = await Promise.all(
      Array.from({ length: 100 }, (_, index) => {
        const adapter = index % 2 === 0 ? fixture.first : fixture.second
        return adapter.takeHttpSlot(identities[index % identities.length])
      }),
    )
    expect(accepted.filter(Boolean)).toHaveLength(60)
    expect(await fixture.first.takeHttpSlot(identities[0])).toBe(false)
    expect(await fixture.second.takeHttpSlot(identities[1])).toBe(false)
    setSystemTime(new Date('2035-01-01T00:01:00.000Z'))
    expect(await fixture.second.takeHttpSlot(fixture.identity('observer'))).toBe(true)
    expect(await fixture.first.takeHttpSlot(fixture.identity('agent'))).toBe(true)
  })

  it('shares credential cooldowns without blocking unrelated credentials or charging rejected requests', async () => {
    const now = new Date('2035-01-01T00:00:00.000Z').getTime()
    setSystemTime(new Date(now))
    const blocked = fixture.identity('limited')
    const healthy = fixture.identity('healthy')
    await fixture.first.blockHttpUntil({ ...blocked, until: now + 10_000 })
    await fixture.second.blockHttpUntil({ ...blocked, until: now + 1000 })
    setSystemTime(new Date(now + 2000))
    expect(await fixture.first.takeHttpSlot(blocked)).toBe(false)
    expect(await fixture.second.takeHttpSlot(blocked)).toBe(false)
    expect(await fixture.second.takeHttpSlot(healthy)).toBe(true)
    const remaining = await Promise.all(
      Array.from({ length: 59 }, () => fixture.first.takeHttpSlot(healthy)),
    )
    expect(remaining.every(Boolean)).toBe(true)
    expect(await fixture.second.takeHttpSlot(healthy)).toBe(false)
    setSystemTime(new Date(now + 60_001))
    expect(await fixture.second.takeHttpSlot(fixture.identity('limited'))).toBe(true)
  })

  it('shares bounded exponential attempt backoff, resets success, and leaves unrelated targets untouched', async () => {
    const now = new Date('2035-01-01T00:00:00.000Z').getTime()
    setSystemTime(new Date(now))
    const key = 'owner/repo#42'
    fixture.key(`attempt:${key}`)
    expect(await fixture.second.attempt(key)).toEqual({ failures: 0, nextAttemptAt: 0 })
    const delays = [60_000, 120_000, 240_000, 480_000, 600_000, 600_000, 600_000, 600_000, 600_000]
    for (const [index, delay] of delays.entries()) {
      const adapter = index % 2 === 0 ? fixture.first : fixture.second
      await adapter.recordAttempt({ key, failed: true })
      expect(await fixture.second.attempt(key)).toEqual({
        failures: Math.min(index + 1, 8),
        nextAttemptAt: now + delay,
      })
    }
    const ttl = await fixture.services.first.client().pttl(fixture.key(`attempt:${key}`))
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(1_200_000)
    await fixture.second.recordAttempt({ key, failed: false })
    expect(await fixture.first.attempt(key)).toEqual({ failures: 0, nextAttemptAt: now + 30_000 })
    expect(await fixture.first.attempt('owner/elsewhere#42')).toEqual({
      failures: 0,
      nextAttemptAt: 0,
    })
  })
})
