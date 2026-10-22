import { ConflictException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedSandboxRow, seedUsers } from '../../../../test/session-seed'
import { hashSessionToken } from '../sandboxes/sandbox-tokens'
import { PodLeasesService } from './pod-leases.service'

const leaseRows = () => db.orm.public.LocalPodLease.all()

describe('PodLeasesService', () => {
  useTestDatabase()
  let service: PodLeasesService

  beforeEach(async () => {
    await seedUsers('user-a', 'user-b')
    service = new PodLeasesService()
  })

  it('stores only the hash of the token', async () => {
    await service.register({ userId: 'user-a', threadId: 'brn_1', token: 'raw-token' })

    const rows = await leaseRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      userId: 'user-a',
      threadId: 'brn_1',
      tokenHash: hashSessionToken('raw-token'),
    })
    expect(JSON.stringify(rows)).not.toContain('raw-token')
  })

  it('replaces the hash when the same thread registers again', async () => {
    await service.register({ userId: 'user-a', threadId: 'brn_1', token: 'first' })
    await service.register({ userId: 'user-a', threadId: 'brn_1', token: 'second' })

    const rows = await leaseRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.tokenHash).toBe(hashSessionToken('second'))
  })

  it('accepts re-registering the same token for the same thread', async () => {
    await service.register({ userId: 'user-a', threadId: 'brn_1', token: 'same' })
    await service.register({ userId: 'user-a', threadId: 'brn_1', token: 'same' })

    expect(await leaseRows()).toHaveLength(1)
  })

  it('refuses a token already held by a CloudSandbox, whoever owns it', async () => {
    await seedSandboxRow({
      id: 'sbx_1',
      userId: 'user-b',
      threadId: 'brn_sandbox',
      tokenHash: hashSessionToken('sandbox-token'),
    })

    await expect(
      service.register({ userId: 'user-a', threadId: 'brn_1', token: 'sandbox-token' }),
    ).rejects.toBeInstanceOf(ConflictException)
    await expect(
      service.register({ userId: 'user-b', threadId: 'brn_1', token: 'sandbox-token' }),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(await leaseRows()).toHaveLength(0)
  })

  it('refuses a token already held by a different lease with a conflict', async () => {
    await service.register({ userId: 'user-a', threadId: 'brn_1', token: 'shared' })

    await expect(
      service.register({ userId: 'user-b', threadId: 'brn_2', token: 'shared' }),
    ).rejects.toBeInstanceOf(ConflictException)
    await expect(
      service.register({ userId: 'user-a', threadId: 'brn_3', token: 'shared' }),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(await leaseRows()).toHaveLength(1)
  })

  it('releases only the owner\'s lease for the thread, and is idempotent', async () => {
    await service.register({ userId: 'user-a', threadId: 'brn_1', token: 'a1' })
    await service.register({ userId: 'user-a', threadId: 'brn_2', token: 'a2' })
    await service.register({ userId: 'user-b', threadId: 'brn_1', token: 'b1' })

    await service.release({ userId: 'user-a', threadId: 'brn_1' })
    await service.release({ userId: 'user-a', threadId: 'brn_1' })

    expect((await leaseRows()).map((row) => `${row.userId}/${row.threadId}`).sort()).toEqual([
      'user-a/brn_2',
      'user-b/brn_1',
    ])
  })
})
