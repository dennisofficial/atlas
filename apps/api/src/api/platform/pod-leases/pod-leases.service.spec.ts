import { ConflictException } from '@nestjs/common'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { PrismaClient } from '../../../generated/prisma/client'

mock.module('../../../db', () => ({ db: fakeSessionDb().db as unknown as PrismaClient }))

import { fakeSessionDb, type FakeCloudSandboxRow } from '../../../../test/fake-session-db.js'
import { hashSessionToken } from '../sandboxes/sandbox-tokens'
import { PodLeasesService } from './pod-leases.service'

const fake = fakeSessionDb()

describe('PodLeasesService', () => {
  let service: PodLeasesService

  beforeEach(() => {
    fake.reset()
    service = new PodLeasesService()
  })

  it('stores only the hash of the token', async () => {
    await service.register({ userId: 'user-a', threadId: 'brn_1', token: 'raw-token' })

    expect(fake.podLeaseRows).toHaveLength(1)
    expect(fake.podLeaseRows[0]).toMatchObject({
      userId: 'user-a',
      threadId: 'brn_1',
      tokenHash: hashSessionToken('raw-token'),
    })
    expect(JSON.stringify(fake.podLeaseRows)).not.toContain('raw-token')
  })

  it('replaces the hash when the same thread registers again', async () => {
    await service.register({ userId: 'user-a', threadId: 'brn_1', token: 'first' })
    await service.register({ userId: 'user-a', threadId: 'brn_1', token: 'second' })

    expect(fake.podLeaseRows).toHaveLength(1)
    expect(fake.podLeaseRows[0]?.tokenHash).toBe(hashSessionToken('second'))
  })

  it('accepts re-registering the same token for the same thread', async () => {
    await service.register({ userId: 'user-a', threadId: 'brn_1', token: 'same' })
    await service.register({ userId: 'user-a', threadId: 'brn_1', token: 'same' })

    expect(fake.podLeaseRows).toHaveLength(1)
  })

  it('refuses a token already held by a CloudSandbox, whoever owns it', async () => {
    fake.cloudSandboxes.push({
      id: 'sbx_1',
      userId: 'user-b',
      threadId: 'brn_sandbox',
      tokenHash: hashSessionToken('sandbox-token'),
    } as unknown as FakeCloudSandboxRow)

    await expect(
      service.register({ userId: 'user-a', threadId: 'brn_1', token: 'sandbox-token' }),
    ).rejects.toBeInstanceOf(ConflictException)
    await expect(
      service.register({ userId: 'user-b', threadId: 'brn_1', token: 'sandbox-token' }),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(fake.podLeaseRows).toHaveLength(0)
  })

  it('refuses a token already held by a different lease with a conflict', async () => {
    await service.register({ userId: 'user-a', threadId: 'brn_1', token: 'shared' })

    await expect(
      service.register({ userId: 'user-b', threadId: 'brn_2', token: 'shared' }),
    ).rejects.toBeInstanceOf(ConflictException)
    await expect(
      service.register({ userId: 'user-a', threadId: 'brn_3', token: 'shared' }),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(fake.podLeaseRows).toHaveLength(1)
  })

  it("releases only the owner's lease for the thread, and is idempotent", async () => {
    await service.register({ userId: 'user-a', threadId: 'brn_1', token: 'a1' })
    await service.register({ userId: 'user-a', threadId: 'brn_2', token: 'a2' })
    await service.register({ userId: 'user-b', threadId: 'brn_1', token: 'b1' })

    await service.release({ userId: 'user-a', threadId: 'brn_1' })
    await service.release({ userId: 'user-a', threadId: 'brn_1' })

    expect(fake.podLeaseRows.map((row) => `${row.userId}/${row.threadId}`).sort()).toEqual([
      'user-a/brn_2',
      'user-b/brn_1',
    ])
  })
})
