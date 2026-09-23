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

  it('upsert creates a connection for a new provider account', async () => {
    const created = await service.upsert({
      provider: EFactoryConnectionProvider.Linear,
      externalAccountId: 'ws-1',
      organizationId: 'org_compai',
      status: 'active',
    })

    expect(created).toMatchObject({
      organizationId: 'org_compai',
      provider: 'linear',
      externalAccountId: 'ws-1',
      status: 'active',
    })
    expect(created.id).toMatch(/^fco_/)
    expect(fake.connections).toHaveLength(1)
  })

  it('upsert repoints an existing connection at the new organization', async () => {
    seedConnection()

    const updated = await service.upsert({
      provider: EFactoryConnectionProvider.GitHub,
      externalAccountId: '87123',
      organizationId: 'org_other',
      status: 'active',
    })

    expect(updated.id).toBe('fco_1')
    expect(updated.organizationId).toBe('org_other')
    expect(fake.connections).toHaveLength(1)
  })

  it('upsert leaves a same-provider neighbor account untouched', async () => {
    seedConnection()

    await service.upsert({
      provider: EFactoryConnectionProvider.GitHub,
      externalAccountId: '99999',
      organizationId: 'org_other',
      status: 'active',
    })

    expect(fake.connections).toHaveLength(2)
    expect(fake.connections[0]?.organizationId).toBe('org_compai')
  })

  it('upsert stores sealed credentials and scopes on create', async () => {
    await service.upsert({
      provider: EFactoryConnectionProvider.Linear,
      externalAccountId: 'ws-1',
      organizationId: 'org_compai',
      status: 'active',
      sealedCredentials: 'sealed-blob',
      scopes: 'read,write',
    })

    expect(fake.connections[0]).toMatchObject({
      sealedCredentials: 'sealed-blob',
      scopes: 'read,write',
    })
  })

  it('upsert replaces credentials on repoint when given, and keeps them when omitted', async () => {
    seedConnection({ sealedCredentials: 'sealed-before', scopes: 'read' })

    await service.upsert({
      provider: EFactoryConnectionProvider.GitHub,
      externalAccountId: '87123',
      organizationId: 'org_compai',
      status: 'active',
    })
    expect(fake.connections[0]?.sealedCredentials).toBe('sealed-before')

    await service.upsert({
      provider: EFactoryConnectionProvider.GitHub,
      externalAccountId: '87123',
      organizationId: 'org_compai',
      status: 'active',
      sealedCredentials: 'sealed-after',
      scopes: 'read,write',
    })
    expect(fake.connections[0]).toMatchObject({
      sealedCredentials: 'sealed-after',
      scopes: 'read,write',
    })
  })

  it('listForOrganization returns only the caller organization connections', async () => {
    seedConnection()
    seedConnection({ id: 'fco_2', provider: 'linear', externalAccountId: 'ws-1' })
    seedConnection({ id: 'fco_3', organizationId: 'org_other', externalAccountId: '99999' })

    const listed = await service.listForOrganization({ organizationId: 'org_compai' })

    expect(listed.map((one) => one.id)).toEqual(['fco_1', 'fco_2'])
  })

  it('listForOrganization orders by createdAt ascending', async () => {
    seedConnection({ id: 'fco_new', createdAt: '2026-09-22T02:00:00.000Z' })
    seedConnection({
      id: 'fco_old',
      provider: 'linear',
      externalAccountId: 'ws-1',
      createdAt: '2026-09-21T02:00:00.000Z',
    })

    const listed = await service.listForOrganization({ organizationId: 'org_compai' })

    expect(listed.map((one) => one.id)).toEqual(['fco_old', 'fco_new'])
  })

  it('updateCredentials reseals the connection', async () => {
    seedConnection({ sealedCredentials: 'sealed-before' })

    await service.updateCredentials({ id: 'fco_1', sealedCredentials: 'sealed-after' })

    expect(fake.connections[0]?.sealedCredentials).toBe('sealed-after')
    expect(fake.connections[0]?.updatedAt).not.toBe('2026-09-22T00:00:00.000Z')
  })
})
