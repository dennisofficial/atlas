import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test'
import {
  realRedisCoordinators,
  type RedisCoordinatorFixture,
} from './github-request-coordinator-redis.integration.fixture'

describe('RedisCoordinatorAdapter over independent real Redis connections', () => {
  let fixture: RedisCoordinatorFixture
  beforeEach(async () => {
    fixture = await realRedisCoordinators()
  })
  afterEach(async () => {
    setSystemTime()
    await fixture?.dispose()
  })

  it('keeps one 60-request minute ceiling per credential across simultaneous and instance takes', async () => {
    setSystemTime(new Date('2035-01-01T00:00:00.000Z'))
    const agent = fixture.identity('agent')
    const owner = fixture.identity('owner')
    const accepted = await Promise.all(
      Array.from({ length: 130 }, (_, index) => {
        const adapter = index % 2 === 0 ? fixture.first : fixture.second
        return adapter.takeHttpSlot(index % 2 === 0 ? agent : owner)
      }),
    )
    expect(accepted.filter(Boolean)).toHaveLength(120)
    expect(await fixture.first.takeHttpSlot(agent)).toBe(false)
    expect(await fixture.second.takeHttpSlot(owner)).toBe(false)
    expect(await fixture.second.takeHttpSlot(fixture.identity('unspent'))).toBe(true)
    setSystemTime(new Date('2035-01-01T00:01:00.000Z'))
    expect(await fixture.second.takeHttpSlot(fixture.identity('owner'))).toBe(true)
    expect(await fixture.first.takeHttpSlot(fixture.identity('agent'))).toBe(true)
  })

  it('shares a low-quota reserve only with the credential it belongs to', async () => {
    const now = new Date('2035-01-01T00:00:00.000Z').getTime()
    setSystemTime(new Date(now))
    const reserved = fixture.identity('reserved')
    await fixture.first.holdHttpReserve({ ...reserved, until: now + 10_000 })
    await fixture.second.holdHttpReserve({ ...reserved, until: now + 1_000 })
    expect(await fixture.first.httpReserveUntil(reserved)).toBe(now + 10_000)
    expect(await fixture.second.httpReserveUntil(fixture.identity('other'))).toBe(0)
    expect(await fixture.second.takeHttpSlot(reserved)).toBe(true)
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
