import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test'
import {
  realRedisCoordinators,
  type RedisCoordinatorFixture,
} from './github-request-coordinator-redis.integration.fixture'
import {
  EGithubHttpCategory,
  GITHUB_AUTH_HTTP_BUDGET_PER_MINUTE,
  GITHUB_REFRESH_RESERVED_FOR_REFRESH,
  GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE,
} from './github-request-coordinator.types'

const LOOKUP_SHARE = GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE - GITHUB_REFRESH_RESERVED_FOR_REFRESH

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

  it('charges lookups to the refresh share and leaves authorization its own reserved share', async () => {
    setSystemTime(new Date('2035-01-01T00:00:00.000Z'))
    const credential = fixture.identity('shared')
    const take = (category: EGithubHttpCategory) =>
      fixture.second.takeHttpSlot({ ...credential, category })
    const lookups = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        (index % 2 === 0 ? fixture.first : fixture.second).takeHttpSlot({
          ...credential,
          category: EGithubHttpCategory.Lookup,
        }),
      ),
    )
    expect(lookups.filter(Boolean)).toHaveLength(LOOKUP_SHARE)
    const refreshes = await Promise.all(
      Array.from({ length: GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE - LOOKUP_SHARE }, () =>
        take(EGithubHttpCategory.Refresh),
      ),
    )
    expect(refreshes.every(Boolean)).toBe(true)
    expect(await take(EGithubHttpCategory.Refresh)).toBe(false)
    const authorizations = await Promise.all(
      Array.from({ length: GITHUB_AUTH_HTTP_BUDGET_PER_MINUTE }, () =>
        take(EGithubHttpCategory.Authorization),
      ),
    )
    expect(authorizations.every(Boolean)).toBe(true)
    expect(await take(EGithubHttpCategory.Authorization)).toBe(false)
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

  it('keeps a grant with no expiry, a denial for thirty seconds, and revokes by credential', async () => {
    const now = new Date('2035-01-01T00:00:00.000Z').getTime()
    setSystemTime(new Date(now))
    const repo = (fingerprint: string, full: string) =>
      fixture.key(`authorization:${fingerprint}:${full}`)
    const grant = async (adapter: typeof fixture.first, fingerprint: string, full: string) => {
      const key = `${fingerprint}:${full}`
      const version = await adapter.beginAuthorization(key)
      await adapter.writeAuthorization({
        key,
        state: { version, checkedAt: now, granted: true, deniedUntil: 0 },
      })
    }
    await grant(fixture.first, 'print_a', 'compai/app')
    await grant(fixture.second, 'print_a', 'compai/other')
    await grant(fixture.first, 'print_b', 'compai/app')
    expect(await fixture.second.readAuthorization('print_a:compai/app')).toMatchObject({
      granted: true,
    })
    expect(await fixture.services.first.client().pttl(repo('print_a', 'compai/app'))).toBe(-1)
    setSystemTime(new Date(now + 365 * 24 * 3_600_000))
    expect(await fixture.second.readAuthorization('print_a:compai/other')).toMatchObject({
      granted: true,
    })

    await fixture.first.revokeAuthorization('print_a:compai/app')
    expect(await fixture.second.readAuthorization('print_a:compai/app')).toBeUndefined()
    expect(await fixture.second.readAuthorization('print_a:compai/other')).toMatchObject({
      granted: true,
    })

    await fixture.second.revokeAuthorizations('print_a:')
    expect(await fixture.first.readAuthorization('print_a:compai/other')).toBeUndefined()
    expect(await fixture.first.readAuthorization('print_b:compai/app')).toMatchObject({
      granted: true,
    })
  })

  it('expires a denial from the record itself', async () => {
    const now = new Date('2035-01-01T00:00:00.000Z').getTime()
    setSystemTime(new Date(now))
    const key = 'print_denied:compai/app'
    const version = await fixture.first.beginAuthorization(key)
    await fixture.first.writeAuthorization({
      key,
      state: { version, checkedAt: now, granted: false, deniedUntil: now + 30_000 },
    })
    expect(await fixture.second.readAuthorization(key)).toMatchObject({ granted: false })
    const ttl = await fixture.services.second.client().pttl(fixture.key(`authorization:${key}`))
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(30_000)
    setSystemTime(new Date(now + 30_001))
    expect(await fixture.second.readAuthorization(key)).toBeUndefined()
  })
})
