import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../../test/fake-factory-db.js'
import type { VercelSandboxClient } from '../../platform/sandboxes/vercel-sandbox.client'
import { DEFAULT_ORGANIZATION_ID, EFactoryWorkItemStatus } from '../factory.types'
import { WorkItemsService } from '../work-items.service'
import { FactoryDrivesService } from './drives.service'

const INTAKE = {
  organizationId: DEFAULT_ORGANIZATION_ID,
  repo: 'dennisofficial/factory-scratch',
  sourceKind: 'github',
  surface: 'github',
  externalId: 'dennisofficial/factory-scratch#12',
  aliasKind: 'issue',
}

const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000

describe('FactoryDrivesService', () => {
  const fake = fakeFactoryDb()
  let workItems: WorkItemsService
  let vercel: { ensureDrive: ReturnType<typeof vi.fn>; deleteDrive: ReturnType<typeof vi.fn> }
  let drives: FactoryDrivesService

  beforeEach(() => {
    fake.reset()
    workItems = new WorkItemsService()
    vercel = {
      ensureDrive: vi.fn(async () => undefined),
      deleteDrive: vi.fn(async () => undefined),
    }
    drives = new FactoryDrivesService(vercel as unknown as VercelSandboxClient, workItems)
  })

  it('derives the drive name from the ticket alias and remembers it', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    const name = await drives.ensure({ workItemId: workItem.id })

    expect(name).toBe('factory-dennisofficial-factory-scratch-12')
    expect(vercel.ensureDrive).toHaveBeenCalledWith({ name })
    expect((await workItems.find({ workItemId: workItem.id })).driveName).toBe(name)
  })

  it('ensures the same drive again without renaming it', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    const first = await drives.ensure({ workItemId: workItem.id })
    const second = await drives.ensure({ workItemId: workItem.id })

    expect(second).toBe(first)
    expect(vercel.ensureDrive).toHaveBeenCalledTimes(2)
  })

  it('falls back to the work item id when the intake carried no ticket number', async () => {
    const { workItem } = await workItems.intake({ ...INTAKE, aliasKind: 'ticket', externalId: 'ENG-441' })
    const name = await drives.ensure({ workItemId: workItem.id })

    expect(name).toBe(`factory-${workItem.id.replaceAll('_', '-')}`)
  })

  it('release deletes the drive and clears the column', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    const name = await drives.ensure({ workItemId: workItem.id })

    await expect(drives.release({ workItemId: workItem.id })).resolves.toBe(true)
    expect(vercel.deleteDrive).toHaveBeenCalledWith({ name })
    expect((await workItems.find({ workItemId: workItem.id })).driveName).toBeNull()
  })

  it('a failed delete keeps the drive attached so the sweeper retries', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    const name = await drives.ensure({ workItemId: workItem.id })
    vercel.deleteDrive.mockRejectedValueOnce(new Error('drive is still mounted'))

    await expect(drives.release({ workItemId: workItem.id })).resolves.toBe(false)
    expect((await workItems.find({ workItemId: workItem.id })).driveName).toBe(name)
  })

  it('release is a no-op for a work item without a drive', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    await expect(drives.release({ workItemId: workItem.id })).resolves.toBe(true)
    expect(vercel.deleteDrive).not.toHaveBeenCalled()
  })

  it('the sweeper releases only drives idle past the threshold', async () => {
    const idle = await workItems.intake(INTAKE)
    await drives.ensure({ workItemId: idle.workItem.id })
    const fresh = await workItems.intake({ ...INTAKE, externalId: 'dennisofficial/factory-scratch#13' })
    await drives.ensure({ workItemId: fresh.workItem.id })

    const quietAt = new Date(Date.now() - FIFTEEN_DAYS_MS).toISOString()
    const idleRow = fake.workItems.find((one) => one.id === idle.workItem.id)
    if (idleRow === undefined) throw new Error('missing idle row')
    idleRow.lastActivityAt = quietAt

    await expect(drives.sweepIdle()).resolves.toBe(1)
    expect(vercel.deleteDrive).toHaveBeenCalledTimes(1)
    expect((await workItems.find({ workItemId: idle.workItem.id })).driveName).toBeNull()
    expect((await workItems.find({ workItemId: fresh.workItem.id })).driveName).not.toBeNull()
  })

  it('the sweeper retries terminal work items whose merge-time release failed, without waiting for idle', async () => {
    const { workItem } = await workItems.intake(INTAKE)
    await drives.ensure({ workItemId: workItem.id })
    await workItems.transition({ workItemId: workItem.id, status: EFactoryWorkItemStatus.Merged })
    vercel.deleteDrive.mockClear()

    await expect(drives.sweepIdle()).resolves.toBe(1)
    expect(vercel.deleteDrive).toHaveBeenCalledWith({
      name: 'factory-dennisofficial-factory-scratch-12',
    })
  })
})
