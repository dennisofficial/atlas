import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../../test/fake-factory-db.js'
import { FACTORY_USER_EMAIL, FactoryIdentityService } from './factory-identity'

describe('FactoryIdentityService', () => {
  const fake = fakeFactoryDb()

  beforeEach(() => {
    fake.reset()
  })

  it('creates the factory user once and reuses it', async () => {
    const service = new FactoryIdentityService()
    const first = await service.userId()
    const second = await service.userId()

    expect(first).toBe(second)
    expect(fake.users).toHaveLength(1)
    expect(fake.users[0]?.email).toBe(FACTORY_USER_EMAIL)
  })

  it('adopts the pre-existing factory user rather than creating a second', async () => {
    fake.users.push({ id: 'usr_seed', name: 'Atlas Factory', email: FACTORY_USER_EMAIL })
    const service = new FactoryIdentityService()

    expect(await service.userId()).toBe('usr_seed')
    expect(fake.users).toHaveLength(1)
  })

  it('retries after a failure instead of caching it', async () => {
    const service = new FactoryIdentityService()
    const upsert = fake.db.user.upsert.bind(fake.db.user)
    fake.db.user.upsert = vi.fn(async () => {
      throw new Error('database down')
    })

    await expect(service.userId()).rejects.toThrow('database down')

    fake.db.user.upsert = upsert
    await expect(service.userId()).resolves.toMatch(/^usr_/)
  })
})
