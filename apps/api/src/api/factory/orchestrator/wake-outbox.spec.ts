import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../../test/fake-factory-db.js'
import { TranscriptService } from '../transcript.service'
import { EWakeOutboxStatus, enqueueWake } from './wake-outbox'
import { WakeRecoveryService } from './wake-recovery'

const INTAKE = {
  organizationId: 'org_atlas_default',
  repo: 'compai/atlas',
  sourceKind: 'github',
  surface: 'github',
  externalId: 'compai/atlas#341',
  aliasKind: 'issue',
}

const seedWorkItem = async (workItemId: string): Promise<void> => {
  await fakeFactoryDb().db.factoryWorkItem.create({
    data: {
      id: workItemId,
      organizationId: INTAKE.organizationId,
      repo: INTAKE.repo,
      sourceKind: INTAKE.sourceKind,
      status: 'active',
      lastActivityAt: '2026-09-25T00:00:00.000Z',
      createdAt: '2026-09-25T00:00:00.000Z',
      updatedAt: '2026-09-25T00:00:00.000Z',
    },
  })
}

describe('wake outbox', () => {
  const fake = fakeFactoryDb()
  let recovery: WakeRecoveryService

  beforeEach(() => {
    fake.reset()
    recovery = new WakeRecoveryService(new TranscriptService())
  })

  it('enqueues a durable row that the drainer drives and marks delivered', async () => {
    await seedWorkItem('fwi_one')
    await enqueueWake({ workItemId: 'fwi_one', externalId: INTAKE.externalId, repo: INTAKE.repo })

    const driver = { runWake: vi.fn(async () => undefined) }
    recovery.registerDriver(driver)
    await recovery.drainOutbox()

    expect(driver.runWake).toHaveBeenCalledWith({
      workItemId: 'fwi_one',
      externalId: INTAKE.externalId,
      repo: INTAKE.repo,
    })
    expect(fake.wakeOutbox[0]?.status).toBe(EWakeOutboxStatus.Delivered)
    expect(fake.wakeOutbox[0]?.deliveredAt).not.toBeNull()
  })

  it('drains the oldest wake first', async () => {
    await seedWorkItem('fwi_one')
    await seedWorkItem('fwi_two')
    await enqueueWake({ workItemId: 'fwi_one', externalId: 'compai/atlas#1' })
    await enqueueWake({ workItemId: 'fwi_two', externalId: 'compai/atlas#2' })
    fake.wakeOutbox[1]!.createdAt = '2026-09-24T00:00:00.000Z'

    const order: string[] = []
    recovery.registerDriver({
      runWake: async (args: { workItemId: string }) => {
        order.push(args.workItemId)
      },
    })
    await recovery.drainOutbox()

    expect(order).toEqual(['fwi_two', 'fwi_one'])
  })

  it('a failed drive leaves the row enqueued, and the rest drive on the next pass', async () => {
    await seedWorkItem('fwi_one')
    await seedWorkItem('fwi_two')
    await enqueueWake({ workItemId: 'fwi_one', externalId: 'compai/atlas#1' })
    await enqueueWake({ workItemId: 'fwi_two', externalId: 'compai/atlas#2' })

    const driven: string[] = []
    let failOnce = true
    recovery.registerDriver({
      runWake: async (args: { workItemId: string }) => {
        driven.push(args.workItemId)
        if (args.workItemId === 'fwi_one' && failOnce) {
          failOnce = false
          throw new Error('sandbox exploded')
        }
      },
    })
    await expect(recovery.drainOutbox()).rejects.toThrow('sandbox exploded')

    expect(driven).toEqual(['fwi_one'])
    expect(fake.wakeOutbox.find((one) => one.workItemId === 'fwi_one')?.status).toBe(
      EWakeOutboxStatus.Enqueued,
    )

    await recovery.drainOutbox()
    expect(driven).toEqual(['fwi_one', 'fwi_one', 'fwi_two'])
    expect(fake.wakeOutbox.find((one) => one.workItemId === 'fwi_one')?.status).toBe(
      EWakeOutboxStatus.Delivered,
    )
    expect(fake.wakeOutbox.find((one) => one.workItemId === 'fwi_two')?.status).toBe(
      EWakeOutboxStatus.Delivered,
    )
  })

  it('boot recovery re-enqueues a wake abandoned mid-drive and drives it', async () => {
    await seedWorkItem('fwi_one')
    const id = await enqueueWake({ workItemId: 'fwi_one', externalId: INTAKE.externalId })
    await fake.db.factoryWakeOutbox.update({
      where: { id },
      data: { status: EWakeOutboxStatus.Started },
    })

    const driver = { runWake: vi.fn(async () => undefined) }
    recovery.registerDriver(driver)
    await recovery.onApplicationBootstrap()

    expect(driver.runWake).toHaveBeenCalledWith({
      workItemId: 'fwi_one',
      externalId: INTAKE.externalId,
    })
    expect(fake.wakeOutbox).toHaveLength(0)
  })

  it('boot recovery drives a work item whose wake never reached the outbox at all', async () => {
    await seedWorkItem('fwi_orphan')
    await fake.db.factoryTranscriptEvent.create({
      data: {
        id: 'fev_orphan',
        workItemId: 'fwi_orphan',
        surface: 'github',
        deliveryId: 'd-orphan',
        author: 'dennislysenko',
        authorAssociation: 'owner',
        kind: 'comment',
        payload: '{}',
        receivedAt: '2026-09-25T00:00:00.000Z',
      },
    })

    const driver = { runWake: vi.fn(async () => undefined) }
    recovery.registerDriver(driver)
    await recovery.onApplicationBootstrap()

    expect(driver.runWake).toHaveBeenCalledWith({
      workItemId: 'fwi_orphan',
      externalId: 'fwi_orphan',
      repo: INTAKE.repo,
    })
  })

  it('boot leaves a delivered wake alone', async () => {
    await seedWorkItem('fwi_one')
    const id = await enqueueWake({ workItemId: 'fwi_one', externalId: INTAKE.externalId })
    await fake.db.factoryWakeOutbox.update({
      where: { id },
      data: { status: EWakeOutboxStatus.Delivered, deliveredAt: '2026-09-25T00:00:00.000Z' },
    })

    const driver = { runWake: vi.fn(async () => undefined) }
    recovery.registerDriver(driver)
    await recovery.onApplicationBootstrap()

    expect(driver.runWake).not.toHaveBeenCalled()
    expect(fake.wakeOutbox).toHaveLength(0)
  })

  it('without a driver the claimed row is returned to the queue', async () => {
    await seedWorkItem('fwi_one')
    await enqueueWake({ workItemId: 'fwi_one', externalId: INTAKE.externalId })

    await recovery.drainOutbox()

    expect(fake.wakeOutbox[0]?.status).toBe(EWakeOutboxStatus.Enqueued)
  })
})
