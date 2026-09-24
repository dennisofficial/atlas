import { ForbiddenException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

import { fakeFactoryDb } from '../../../../test/fake-factory-db.js'
import type { GithubSurfaceService } from '../reply/github-surface.service'
import { WorkItemsService } from '../work-items.service'
import { FactoryGithubToolsService } from './tools-github.service'

const ORCHESTRATOR_THREAD = 'brn_orchestrator_1'
const COORDS = { owner: 'compai', repo: 'atlas', number: 341 }
const SURFACE_ID = 'compai/atlas#341'

const fake = fakeFactoryDb()

function seedOrchestratedItem(args: { withGithubAlias: boolean }): void {
  fake.workItems.push({
    id: 'fwi_1',
    organizationId: 'org_compai',
    repo: 'compai/atlas',
    sourceKind: 'github',
    status: 'active',
    orchestratorThreadId: ORCHESTRATOR_THREAD,
    orchestratorDeliveredEventId: null,
    driveName: null,
    revisionCycles: 0,
    lastActivityAt: '2026-09-24T00:00:00.000Z',
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
  })
  if (args.withGithubAlias) {
    fake.aliases.push({
      id: 'fal_1',
      workItemId: 'fwi_1',
      surface: 'github',
      externalId: SURFACE_ID,
      kind: 'issue',
      createdAt: '2026-09-24T00:00:00.000Z',
    })
  }
}

describe('FactoryGithubToolsService', () => {
  let service: FactoryGithubToolsService
  let surface: {
    getIssue: ReturnType<typeof vi.fn>
    getIssueComments: ReturnType<typeof vi.fn>
    getPullRequest: ReturnType<typeof vi.fn>
    getPullRequestDiff: ReturnType<typeof vi.fn>
    closeIssue: ReturnType<typeof vi.fn>
    addLabel: ReturnType<typeof vi.fn>
    removeLabel: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    fake.reset()
    surface = {
      getIssue: vi.fn(async () => ({ number: 341, title: 'the issue' })),
      getIssueComments: vi.fn(async () => []),
      getPullRequest: vi.fn(async () => ({ number: 87, draft: true })),
      getPullRequestDiff: vi.fn(async () => 'diff --git a/x b/x'),
      closeIssue: vi.fn(async () => ({ url: 'https://github.com/compai/atlas/issues/341' })),
      addLabel: vi.fn(async () => undefined),
      removeLabel: vi.fn(async () => undefined),
    }
    service = new FactoryGithubToolsService(
      new WorkItemsService(),
      surface as unknown as GithubSurfaceService,
    )
  })

  it('a non-orchestrator thread is refused before any github call', async () => {
    await expect(
      service.getIssue({ threadId: 'brn_stranger', ...COORDS }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(surface.getIssue).not.toHaveBeenCalled()
  })

  it('reads need no alias — the installation is the read boundary', async () => {
    seedOrchestratedItem({ withGithubAlias: false })

    await service.getIssue({ threadId: ORCHESTRATOR_THREAD, ...COORDS })
    await service.getIssueComments({ threadId: ORCHESTRATOR_THREAD, ...COORDS })
    await service.getPullRequest({ threadId: ORCHESTRATOR_THREAD, ...COORDS })
    const { diff } = await service.getPullRequestDiff({ threadId: ORCHESTRATOR_THREAD, ...COORDS })

    expect(surface.getIssue).toHaveBeenCalledWith(COORDS)
    expect(surface.getPullRequestDiff).toHaveBeenCalledWith(COORDS)
    expect(diff).toBe('diff --git a/x b/x')
  })

  it('closeIssue comments and closes on an aliased issue', async () => {
    seedOrchestratedItem({ withGithubAlias: true })

    const closed = await service.closeIssue({
      threadId: ORCHESTRATOR_THREAD,
      ...COORDS,
      body: 'covered by the linked PR',
    })

    expect(closed.url).toContain('/issues/341')
    expect(surface.closeIssue).toHaveBeenCalledWith({ ...COORDS, body: 'covered by the linked PR' })
  })

  it('closeIssue refuses an issue that is not a surface of the work item', async () => {
    seedOrchestratedItem({ withGithubAlias: false })

    await expect(
      service.closeIssue({ threadId: ORCHESTRATOR_THREAD, ...COORDS, body: 'drive-by close' }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(surface.closeIssue).not.toHaveBeenCalled()
  })

  it('label writes are alias-scoped', async () => {
    seedOrchestratedItem({ withGithubAlias: true })

    await service.addLabel({ threadId: ORCHESTRATOR_THREAD, ...COORDS, label: 'triaged' })
    await service.removeLabel({ threadId: ORCHESTRATOR_THREAD, ...COORDS, label: 'atlas-factory' })

    expect(surface.addLabel).toHaveBeenCalledWith({ ...COORDS, label: 'triaged' })
    expect(surface.removeLabel).toHaveBeenCalledWith({ ...COORDS, label: 'atlas-factory' })
  })

  it('label writes refuse an unaliased issue', async () => {
    seedOrchestratedItem({ withGithubAlias: false })

    await expect(
      service.addLabel({ threadId: ORCHESTRATOR_THREAD, ...COORDS, label: 'triaged' }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(surface.addLabel).not.toHaveBeenCalled()
  })
})
