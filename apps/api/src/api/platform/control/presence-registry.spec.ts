import { describe, expect, it } from 'bun:test'
import { EClientSurface } from '@dltech/atlas-core'

import type { PresenceHash } from '@dltech/atlas-notifications/server'

import { PresenceRegistry, type PresenceRedis } from './presence-registry'

const AT = '2026-11-23T14:00:00.000Z'

const atOffsetMs = (offset: number): string => new Date(Date.parse(AT) + offset).toISOString()

class FakeRedis implements PresenceHash {
  readonly hashes = new Map<string, Map<string, string>>()
  readonly expiries: number[] = []
  failure: Error | undefined

  hset(key: string, field: string, value: string): Promise<number> {
    if (this.failure !== undefined) return Promise.reject(this.failure)
    const hash = this.hashes.get(key) ?? new Map<string, string>()
    hash.set(field, value)
    this.hashes.set(key, hash)
    return Promise.resolve(1)
  }

  hdel(key: string, field: string): Promise<number> {
    if (this.failure !== undefined) return Promise.reject(this.failure)
    this.hashes.get(key)?.delete(field)
    return Promise.resolve(1)
  }

  hgetall(key: string): Promise<Record<string, string>> {
    if (this.failure !== undefined) return Promise.reject(this.failure)
    return Promise.resolve(Object.fromEntries(this.hashes.get(key) ?? []))
  }

  expire(key: string, seconds: number): Promise<number> {
    if (this.failure !== undefined) return Promise.reject(this.failure)
    this.expiries.push(seconds)
    return Promise.resolve(1)
  }

  record(clientId: string): Record<string, unknown> | undefined {
    const raw = this.hashes.get('atlas:v2:presence:usr-1')?.get(clientId)
    return raw === undefined ? undefined : JSON.parse(raw)
  }
}

const registryWith = (args: { configured: boolean; redis: FakeRedis }): PresenceRegistry =>
  new PresenceRegistry({
    isConfigured: () => args.configured,
    client: () => args.redis,
  } satisfies PresenceRedis)

const report = (args: { foreground: boolean; sessionId: string | null }) => ({
  userId: 'usr-1',
  clientId: 'client-a',
  surface: EClientSurface.Desktop,
  sessionId: args.sessionId,
  foreground: args.foreground,
})

describe('PresenceRegistry.report', () => {
  it('writes the field of a foreground client with its surface and an ISO timestamp', async () => {
    const redis = new FakeRedis()
    await registryWith({ configured: true, redis }).report(
      report({ foreground: true, sessionId: 'session-1' }),
    )

    const record = redis.record('client-a')
    expect(record?.surface).toBe('desktop')
    expect(record?.sessionId).toBe('session-1')
    expect(record?.foreground).toBe(true)
    expect(typeof record?.at).toBe('string')
    expect(Number.isNaN(Date.parse(String(record?.at)))).toBe(false)
    expect(redis.expiries).toEqual([90])
  })

  it('deletes the field on an away report', async () => {
    const redis = new FakeRedis()
    const registry = registryWith({ configured: true, redis })
    await registry.report(report({ foreground: true, sessionId: 'session-1' }))
    await registry.report(report({ foreground: false, sessionId: 'session-1' }))

    expect(redis.record('client-a')).toBeUndefined()
  })

  it('writes nothing when Redis is not configured', async () => {
    const redis = new FakeRedis()
    await registryWith({ configured: false, redis }).report(
      report({ foreground: true, sessionId: 'session-1' }),
    )

    expect(redis.record('client-a')).toBeUndefined()
  })

  it('swallows a Redis failure', async () => {
    const redis = new FakeRedis()
    redis.failure = new Error('redis is down')

    await expect(
      registryWith({ configured: true, redis }).report(
        report({ foreground: true, sessionId: 'session-1' }),
      ),
    ).resolves.toBeUndefined()
  })
})

describe('PresenceRegistry.read', () => {
  it('returns a fresh record of the caller', async () => {
    const redis = new FakeRedis()
    const registry = registryWith({ configured: true, redis })
    await registry.report(report({ foreground: true, sessionId: 'session-1' }))

    const records = await registry.read({ userId: 'usr-1', now: new Date().toISOString() })
    expect(records).toHaveLength(1)
    expect(records[0]?.sessionId).toBe('session-1')
  })

  it('never counts an expired record', async () => {
    const redis = new FakeRedis()
    const registry = registryWith({ configured: true, redis })
    await registry.report(report({ foreground: true, sessionId: 'session-1' }))
    const record = redis.record('client-a')
    const hash = redis.hashes.get('atlas:v2:presence:usr-1')
    hash?.set('client-a', JSON.stringify({ ...record, at: AT }))

    expect(await registry.read({ userId: 'usr-1', now: atOffsetMs(91_000) })).toEqual([])
  })

  it('answers no presence when Redis is not configured', async () => {
    const redis = new FakeRedis()
    expect(
      await registryWith({ configured: false, redis }).read({ userId: 'usr-1', now: AT }),
    ).toEqual([])
  })

  it('answers no presence when Redis fails', async () => {
    const redis = new FakeRedis()
    redis.failure = new Error('redis is down')
    expect(
      await registryWith({ configured: true, redis }).read({ userId: 'usr-1', now: AT }),
    ).toEqual([])
  })
})
