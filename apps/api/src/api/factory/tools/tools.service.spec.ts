import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeFactoryDb } = await import('../../../../test/fake-factory-db.js')
  return { db: fakeFactoryDb().db as unknown as PrismaClient }
})

vi.mock('../linear/linear-client', () => ({
  getIssue: vi.fn(async () => ({ id: 'lin-1', identifier: 'COM-1' })),
  createComment: vi.fn(async () => ({ url: 'https://linear.app/compai/issue/COM-1#comment-1' })),
  setState: vi.fn(async () => ({ stateName: 'Done' })),
  markDuplicate: vi.fn(async () => ({ url: 'https://linear.app/compai/issue/COM-1' })),
}))

import { fakeFactoryDb } from '../../../../test/fake-factory-db.js'
import { FactoryConnectionsService } from '../connections/connections.service'
import { createComment, getIssue, markDuplicate, setState } from '../linear/linear-client'
import type { LinearTokensService } from '../linear/linear-tokens.service'
import { WorkItemsService } from '../work-items.service'
import { FactoryToolsService } from './tools.service'

const ORCHESTRATOR_THREAD = 'brn_orchestrator_1'
const LINEAR_ISSUE = '2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9'

function seedOrchestratedItem(args: { withLinearAlias: boolean }): void {
  fake.workItems.push({
    id: 'fwi_1',
    organizationId: 'org_compai',
    repo: 'compai/atlas',
    sourceKind: 'linear',
    status: 'active',
    orchestratorThreadId: ORCHESTRATOR_THREAD,
    orchestratorDeliveredEventId: null,
    driveName: null,
    revisionCycles: 0,
    lastActivityAt: '2026-09-24T00:00:00.000Z',
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
  })
  if (args.withLinearAlias) {
    fake.aliases.push({
      id: 'fal_1',
      workItemId: 'fwi_1',
      surface: 'linear',
      externalId: LINEAR_ISSUE,
      kind: 'issue',
      createdAt: '2026-09-24T00:00:00.000Z',
    })
  }
}

function seedLinearConnection(): void {
  fake.connections.push({
    id: 'fco_1',
    organizationId: 'org_compai',
    provider: 'linear',
    externalAccountId: 'linear-workspace-1',
    sealedCredentials: 'sealed',
    scopes: null,
    status: 'active',
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
  })
}

const fake = fakeFactoryDb()

describe('FactoryToolsService', () => {
  let service: FactoryToolsService
  let linearTokens: { getToken: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    fake.reset()
    vi.mocked(getIssue).mockClear()
    vi.mocked(createComment).mockClear()
    vi.mocked(setState).mockClear()
    vi.mocked(markDuplicate).mockClear()
    linearTokens = { getToken: vi.fn(async () => 'linear-oauth-token') }
    service = new FactoryToolsService(
      new WorkItemsService(),
      new FactoryConnectionsService(),
      linearTokens as unknown as LinearTokensService,
    )
  })

  it('a non-orchestrator thread is refused before any provider call', async () => {
    await expect(
      service.getLinearIssue({ threadId: 'brn_stranger', issueId: LINEAR_ISSUE }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(getIssue).not.toHaveBeenCalled()
  })

  it('getLinearIssue reads with the organization linear token, no alias required', async () => {
    seedOrchestratedItem({ withLinearAlias: false })
    seedLinearConnection()

    const issue = await service.getLinearIssue({
      threadId: ORCHESTRATOR_THREAD,
      issueId: LINEAR_ISSUE,
    })

    expect(issue.identifier).toBe('COM-1')
    expect(linearTokens.getToken).toHaveBeenCalledWith({ workspaceId: 'linear-workspace-1' })
    expect(getIssue).toHaveBeenCalledWith({ token: 'linear-oauth-token', issueId: LINEAR_ISSUE })
  })

  it('getLinearIssue refuses when the organization has no linear connection', async () => {
    seedOrchestratedItem({ withLinearAlias: false })

    await expect(
      service.getLinearIssue({ threadId: ORCHESTRATOR_THREAD, issueId: LINEAR_ISSUE }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('commentLinearIssue posts on an aliased issue', async () => {
    seedOrchestratedItem({ withLinearAlias: true })
    seedLinearConnection()

    const posted = await service.commentLinearIssue({
      threadId: ORCHESTRATOR_THREAD,
      issueId: LINEAR_ISSUE,
      body: 'looking at this now',
    })

    expect(posted.url).toContain('COM-1')
    expect(createComment).toHaveBeenCalledWith({
      token: 'linear-oauth-token',
      issueId: LINEAR_ISSUE,
      body: 'looking at this now',
    })
  })

  it('commentLinearIssue refuses an issue that is not a surface of the work item', async () => {
    seedOrchestratedItem({ withLinearAlias: false })
    seedLinearConnection()

    await expect(
      service.commentLinearIssue({
        threadId: ORCHESTRATOR_THREAD,
        issueId: LINEAR_ISSUE,
        body: 'drive-by comment',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(createComment).not.toHaveBeenCalled()
  })

  it('setLinearState is alias-scoped and forwards the state name', async () => {
    seedOrchestratedItem({ withLinearAlias: true })
    seedLinearConnection()

    const updated = await service.setLinearState({
      threadId: ORCHESTRATOR_THREAD,
      issueId: LINEAR_ISSUE,
      stateName: 'done',
    })

    expect(updated.stateName).toBe('Done')
    expect(setState).toHaveBeenCalledWith({
      token: 'linear-oauth-token',
      issueId: LINEAR_ISSUE,
      stateName: 'done',
    })
  })

  it('markLinearDuplicate is alias-scoped on the issue being closed', async () => {
    seedOrchestratedItem({ withLinearAlias: true })
    seedLinearConnection()

    await service.markLinearDuplicate({
      threadId: ORCHESTRATOR_THREAD,
      issueId: LINEAR_ISSUE,
      duplicateOfId: 'other-issue-id',
    })

    expect(markDuplicate).toHaveBeenCalledWith({
      token: 'linear-oauth-token',
      issueId: LINEAR_ISSUE,
      duplicateOfId: 'other-issue-id',
    })
  })
})
