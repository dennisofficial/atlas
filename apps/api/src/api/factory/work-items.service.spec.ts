import { ConflictException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../generated/prisma/client'

vi.mock('../../db', async () => {
  const { fakeFactoryDb } = await import('../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../test/fake-factory-db.js'
import { EFactoryWorkItemStatus } from './factory.types'
import { WorkItemsService } from './work-items.service'

const INTAKE = {
  repo: 'compai/atlas',
  sourceKind: 'github',
  surface: 'github',
  externalId: 'compai/atlas#341',
  aliasKind: 'issue',
}

describe('WorkItemsService', () => {
  const fake = fakeFactoryDb()
  let service: WorkItemsService

  beforeEach(() => {
    fake.reset()
    service = new WorkItemsService()
  })

  it('intake creates the work item and its first alias atomically', async () => {
    const { workItem, created } = await service.intake(INTAKE)

    expect(created).toBe(true)
    expect(workItem.id).toMatch(/^fwi_/)
    expect(workItem.status).toBe(EFactoryWorkItemStatus.Intake)
    expect(fake.aliases).toHaveLength(1)
    expect(fake.aliases[0]).toMatchObject({
      workItemId: workItem.id,
      surface: 'github',
      externalId: 'compai/atlas#341',
    })
  })

  it('intake on an already-aliased surface returns the existing work item', async () => {
    const first = await service.intake(INTAKE)
    const second = await service.intake(INTAKE)

    expect(second.created).toBe(false)
    expect(second.workItem.id).toBe(first.workItem.id)
    expect(fake.workItems).toHaveLength(1)
    expect(fake.aliases).toHaveLength(1)
  })

  it('a concurrent intake that loses the create race returns the existing work item', async () => {
    const first = await service.intake(INTAKE)

    const findFirst = fake.db.factorySurfaceAlias.findFirst.bind(fake.db.factorySurfaceAlias)
    let missesLeft = 1
    fake.db.factorySurfaceAlias.findFirst = (async (args: Parameters<typeof findFirst>[0]) => {
      if (missesLeft > 0) {
        missesLeft -= 1
        return null
      }
      return findFirst(args)
    }) as unknown as typeof findFirst

    let raced: Awaited<ReturnType<WorkItemsService['intake']>>
    try {
      raced = await service.intake(INTAKE)
    } finally {
      fake.db.factorySurfaceAlias.findFirst = findFirst
    }

    expect(raced.created).toBe(false)
    expect(raced.workItem.id).toBe(first.workItem.id)
    expect(fake.workItems).toHaveLength(1)
    expect(fake.aliases).toHaveLength(1)
  })

  it('resolve routes a surface id to its work item, and misses cleanly', async () => {
    const { workItem } = await service.intake(INTAKE)

    const hit = await service.resolve({ surface: 'github', externalId: 'compai/atlas#341' })
    expect(hit?.id).toBe(workItem.id)

    const otherSurface = await service.resolve({ surface: 'linear', externalId: 'compai/atlas#341' })
    expect(otherSurface).toBeNull()

    const unknown = await service.resolve({ surface: 'github', externalId: 'compai/atlas#999' })
    expect(unknown).toBeNull()
  })

  it('registerAlias links a second surface to the same work item', async () => {
    const { workItem } = await service.intake(INTAKE)

    const alias = await service.registerAlias({
      workItemId: workItem.id,
      surface: 'github',
      externalId: 'compai/atlas/pull/87',
      kind: 'pull-request',
    })

    expect(alias.workItemId).toBe(workItem.id)
    const resolved = await service.resolve({ surface: 'github', externalId: 'compai/atlas/pull/87' })
    expect(resolved?.id).toBe(workItem.id)
  })

  it('registerAlias is idempotent for the same work item and refuses another', async () => {
    const first = await service.intake(INTAKE)
    const second = await service.intake({ ...INTAKE, externalId: 'compai/atlas#342' })

    const again = await service.registerAlias({
      workItemId: first.workItem.id,
      surface: 'github',
      externalId: 'compai/atlas#341',
      kind: 'issue',
    })
    expect(again.workItemId).toBe(first.workItem.id)
    expect(fake.aliases).toHaveLength(2)

    await expect(
      service.registerAlias({
        workItemId: second.workItem.id,
        surface: 'github',
        externalId: 'compai/atlas#341',
        kind: 'issue',
      }),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('registerAlias losing the create race returns the stored alias, or conflicts on another item', async () => {
    const first = await service.intake(INTAKE)
    const second = await service.intake({ ...INTAKE, externalId: 'compai/atlas#342' })
    await service.registerAlias({
      workItemId: first.workItem.id,
      surface: 'github',
      externalId: 'compai/atlas/pull/87',
      kind: 'pull-request',
    })

    const findFirst = fake.db.factorySurfaceAlias.findFirst.bind(fake.db.factorySurfaceAlias)
    const missNextLookupOnce = (): void => {
      let missed = false
      fake.db.factorySurfaceAlias.findFirst = (async (args: Parameters<typeof findFirst>[0]) => {
        if (!missed) {
          missed = true
          return null
        }
        return findFirst(args)
      }) as unknown as typeof findFirst
    }
    const restoreLookup = (): void => {
      fake.db.factorySurfaceAlias.findFirst = findFirst
    }

    try {
      missNextLookupOnce()
      const same = await service.registerAlias({
        workItemId: first.workItem.id,
        surface: 'github',
        externalId: 'compai/atlas/pull/87',
        kind: 'pull-request',
      })
      expect(same.workItemId).toBe(first.workItem.id)
      expect(fake.aliases).toHaveLength(3)

      missNextLookupOnce()
      await expect(
        service.registerAlias({
          workItemId: second.workItem.id,
          surface: 'github',
          externalId: 'compai/atlas/pull/87',
          kind: 'pull-request',
        }),
      ).rejects.toBeInstanceOf(ConflictException)
    } finally {
      restoreLookup()
    }
  })

  it('registerAlias refuses an unknown work item', async () => {
    await expect(
      service.registerAlias({
        workItemId: 'fwi_missing',
        surface: 'linear',
        externalId: 'COMP-88',
        kind: 'ticket',
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('attachOrchestrator, attachDrive, transition and countRevision write their fields', async () => {
    const { workItem } = await service.intake(INTAKE)

    await service.attachOrchestrator({ workItemId: workItem.id, threadId: 'brn_orch' })
    await service.attachDrive({ workItemId: workItem.id, driveName: 'factory-compai-atlas-341' })
    await service.countRevision({ workItemId: workItem.id })
    const moved = await service.transition({
      workItemId: workItem.id,
      status: EFactoryWorkItemStatus.Active,
    })

    const found = await service.find({ workItemId: workItem.id })
    expect(found).toMatchObject({
      orchestratorThreadId: 'brn_orch',
      driveName: 'factory-compai-atlas-341',
      revisionCycles: 1,
      status: EFactoryWorkItemStatus.Active,
    })
    expect(Date.parse(moved.lastActivityAt)).toBeGreaterThanOrEqual(Date.parse(workItem.lastActivityAt))
  })
})
