import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../../test/fake-factory-db.js'
import { DEFAULT_ORGANIZATION_ID } from '../factory.types'
import type { GithubAppService } from '../reply/github-app.service'
import { WorkItemsService } from '../work-items.service'
import { StationTokensService } from './station-tokens.service'
import { EStationKind, EStationRunStatus } from './station.types'

const INTAKE = {
  organizationId: DEFAULT_ORGANIZATION_ID,
  repo: 'dennisofficial/factory-scratch',
  sourceKind: 'github',
  surface: 'github',
  externalId: 'dennisofficial/factory-scratch#12',
  aliasKind: 'issue',
}

describe('StationTokensService', () => {
  const fake = fakeFactoryDb()
  let githubApp: { installationToken: ReturnType<typeof vi.fn> }
  let service: StationTokensService
  const stationThreadId = 'brn_station_1'

  beforeEach(async () => {
    fake.reset()
    githubApp = { installationToken: vi.fn(async () => 'ghs_installation') }
    const workItems = new WorkItemsService()
    service = new StationTokensService(workItems, githubApp as unknown as GithubAppService)

    const { workItem } = await workItems.intake(INTAKE)
    const at = new Date().toISOString()
    fake.stationRuns.push({
      id: 'fsr_run_1',
      workItemId: workItem.id,
      kind: EStationKind.Implementer,
      threadId: stationThreadId,
      status: EStationRunStatus.Running,
      driveMode: 'read-write',
      createdAt: at,
      updatedAt: at,
      finishedAt: null,
    })
  })

  it('refuses a caller that is not a running station', async () => {
    await expect(
      service.mintGitToken({ stationThreadId: 'brn_other', branch: 'atlas-factory/x' }),
    ).rejects.toThrow('not a running factory station')
  })

  it('refuses main and master by name', async () => {
    await expect(
      service.mintGitToken({ stationThreadId, branch: 'main' }),
    ).rejects.toThrow('refused')
    await expect(
      service.mintGitToken({ stationThreadId, branch: 'master' }),
    ).rejects.toThrow('refused')
    expect(githubApp.installationToken).not.toHaveBeenCalled()
  })

  it('refuses branches outside the factory prefix', async () => {
    await expect(
      service.mintGitToken({ stationThreadId, branch: 'dennis/feature' }),
    ).rejects.toThrow('atlas-factory/')
  })

  it('mints an installation token for the work item repo', async () => {
    const minted = await service.mintGitToken({
      stationThreadId,
      branch: 'atlas-factory/add-the-thing',
    })
    expect(minted.token).toBe('ghs_installation')
    expect(minted.expiresInSeconds).toBeGreaterThan(0)
    expect(githubApp.installationToken).toHaveBeenCalledWith({
      owner: 'dennisofficial',
      repo: 'factory-scratch',
    })
  })
})
