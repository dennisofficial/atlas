import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb, type FakeConnectionRow } from '../../../../test/fake-factory-db.js'
import { EFactoryConnectionProvider } from '../factory.types'
import { FactoryConnectionsService } from './connections.service'

function seedConnection(overrides: Partial<FakeConnectionRow> = {}): void {
  fakeFactoryDb().connections.push({
    id: 'fco_1',
    organizationId: 'org_compai',
    provider: 'github',
    externalAccountId: '87123',
    sealedCredentials: null,
    scopes: null,
    status: 'active',
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
    ...overrides,
  })
}

describe('FactoryConnectionsService', () => {
  const fake = fakeFactoryDb()
  let service: FactoryConnectionsService

  beforeEach(() => {
    fake.reset()
    service = new FactoryConnectionsService()
  })

  it('resolve returns the connection for a known provider account', async () => {
    seedConnection()

    const found = await service.resolve({
      provider: EFactoryConnectionProvider.GitHub,
      externalAccountId: '87123',
    })

    expect(found).toMatchObject({
      id: 'fco_1',
      organizationId: 'org_compai',
      provider: 'github',
      externalAccountId: '87123',
      status: 'active',
    })
  })

  it('resolve misses an unknown account and a known account on another provider', async () => {
    seedConnection()

    const unknown = await service.resolve({
      provider: EFactoryConnectionProvider.GitHub,
      externalAccountId: '99999',
    })
    const otherProvider = await service.resolve({
      provider: EFactoryConnectionProvider.Linear,
      externalAccountId: '87123',
    })

    expect(unknown).toBeNull()
    expect(otherProvider).toBeNull()
  })
})
