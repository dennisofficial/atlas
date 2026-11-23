import { describe, expect, it } from 'bun:test'

import { EClientSurface, PRESENCE_TTL_MS } from '@dltech/atlas-core'

import {
  PRESENCE_TTL_S,
  presenceKeyOf,
  readPresence,
  writePresence,
  type PresenceHash,
} from '../presence-store'

const AT = '2026-11-23T14:00:00.000Z'

const atOffsetMs = (offset: number): string => new Date(Date.parse(AT) + offset).toISOString()

class FakeRedis implements PresenceHash {
  readonly hashes = new Map<string, Map<string, string>>()
  readonly expiries: { key: string; seconds: number }[] = []

  hset(key: string, field: string, value: string): Promise<number> {
    const hash = this.hashes.get(key) ?? new Map<string, string>()
    hash.set(field, value)
    this.hashes.set(key, hash)
    return Promise.resolve(1)
  }

  hdel(key: string, field: string): Promise<number> {
    const removed = this.hashes.get(key)?.delete(field) === true
    return Promise.resolve(removed ? 1 : 0)
  }

  hgetall(key: string): Promise<Record<string, string>> {
    return Promise.resolve(Object.fromEntries(this.hashes.get(key) ?? []))
  }

  expire(key: string, seconds: number): Promise<number> {
    this.expiries.push({ key, seconds })
    return Promise.resolve(1)
  }
}

describe('presenceKeyOf', () => {
  it('names one hash per user', () => {
    expect(presenceKeyOf('usr-1')).toBe('atlas:v2:presence:usr-1')
  })
})

describe('PRESENCE_TTL_S', () => {
  it('gives the 90 s lifetime in seconds for Redis', () => {
    expect(PRESENCE_TTL_S).toBe(90)
    expect(PRESENCE_TTL_S * 1000).toBe(PRESENCE_TTL_MS)
  })
})

describe('writePresence', () => {
  it('writes the field of a foreground client and refreshes the hash lifetime', async () => {
    const redis = new FakeRedis()
    await writePresence({
      redis,
      userId: 'usr-1',
      clientId: 'client-a',
      presence: {
        surface: EClientSurface.Desktop,
        sessionId: 'session-1',
        foreground: true,
        at: AT,
      },
    })

    const hash = redis.hashes.get('atlas:v2:presence:usr-1')
    expect([...(hash?.keys() ?? [])]).toEqual(['client-a'])
    expect(JSON.parse(hash?.get('client-a') ?? '')).toEqual({
      surface: 'desktop',
      sessionId: 'session-1',
      foreground: true,
      at: AT,
    })
    expect(redis.expiries).toEqual([{ key: 'atlas:v2:presence:usr-1', seconds: 90 }])
  })

  it('deletes the field of an away client and touches no lifetime', async () => {
    const redis = new FakeRedis()
    await writePresence({
      redis,
      userId: 'usr-1',
      clientId: 'client-a',
      presence: { surface: EClientSurface.Web, sessionId: 'session-1', foreground: true, at: AT },
    })
    await writePresence({
      redis,
      userId: 'usr-1',
      clientId: 'client-a',
      presence: { surface: EClientSurface.Web, sessionId: null, foreground: false, at: AT },
    })

    expect(redis.hashes.get('atlas:v2:presence:usr-1')?.size).toBe(0)
    expect(redis.expiries).toHaveLength(1)
  })

  it('keeps each client in its own field', async () => {
    const redis = new FakeRedis()
    await writePresence({
      redis,
      userId: 'usr-1',
      clientId: 'client-a',
      presence: { surface: EClientSurface.Web, sessionId: 'session-1', foreground: true, at: AT },
    })
    await writePresence({
      redis,
      userId: 'usr-1',
      clientId: 'client-b',
      presence: { surface: EClientSurface.Ios, sessionId: null, foreground: true, at: AT },
    })

    expect([...(redis.hashes.get('atlas:v2:presence:usr-1')?.keys() ?? [])]).toEqual([
      'client-a',
      'client-b',
    ])
  })
})

describe('readPresence', () => {
  it('returns one record per fresh field', async () => {
    const redis = new FakeRedis()
    await writePresence({
      redis,
      userId: 'usr-1',
      clientId: 'client-a',
      presence: { surface: EClientSurface.Web, sessionId: 'session-1', foreground: true, at: AT },
    })
    await writePresence({
      redis,
      userId: 'usr-1',
      clientId: 'client-b',
      presence: { surface: EClientSurface.Ios, sessionId: null, foreground: true, at: AT },
    })

    const records = await readPresence({ redis, userId: 'usr-1', now: atOffsetMs(89_000) })
    expect(records).toHaveLength(2)
    expect(records.map((record) => record.surface).sort()).toEqual([
      EClientSurface.Ios,
      EClientSurface.Web,
    ])
  })

  it('never counts an expired field', async () => {
    const redis = new FakeRedis()
    await writePresence({
      redis,
      userId: 'usr-1',
      clientId: 'client-a',
      presence: { surface: EClientSurface.Web, sessionId: 'session-1', foreground: true, at: AT },
    })

    expect(await readPresence({ redis, userId: 'usr-1', now: atOffsetMs(91_000) })).toEqual([])
  })

  it('ignores a field that is not one presence record', async () => {
    const redis = new FakeRedis()
    await redis.hset('atlas:v2:presence:usr-1', 'client-a', 'not json')

    expect(await readPresence({ redis, userId: 'usr-1', now: AT })).toEqual([])
  })

  it('reads only the records of the caller', async () => {
    const redis = new FakeRedis()
    await writePresence({
      redis,
      userId: 'usr-2',
      clientId: 'client-a',
      presence: { surface: EClientSurface.Web, sessionId: 'session-1', foreground: true, at: AT },
    })

    expect(await readPresence({ redis, userId: 'usr-1', now: AT })).toEqual([])
  })
})
