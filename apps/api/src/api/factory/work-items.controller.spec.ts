import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedRequest } from '../../_core/types/auth.types'
import type { WorkItemDto } from './factory.types'
import { WorkItemsController } from './work-items.controller'
import type { WorkItemsService } from './work-items.service'

function requestWith(auth: AuthenticatedRequest['auth']): AuthenticatedRequest {
  return { auth } as unknown as AuthenticatedRequest
}

function workItemDto(overrides: Partial<WorkItemDto> = {}): WorkItemDto {
  return {
    id: 'fwi_1',
    organizationId: 'org_compai',
    repo: 'compai/atlas',
    sourceKind: 'github',
    status: 'intake',
    orchestratorThreadId: null,
    orchestratorDeliveredEventId: null,
    driveName: null,
    revisionCycles: 0,
    lastActivityAt: '2026-09-22T00:00:00.000Z',
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
    ...overrides,
  }
}

const SESSION = {
  userId: 'u-1',
  sessionId: 's-1',
  email: 'd@comp.ai',
  activeOrganizationId: 'org_compai',
}

describe('WorkItemsController', () => {
  let workItems: { listForOrganization: ReturnType<typeof vi.fn> }
  let controller: WorkItemsController

  beforeEach(() => {
    workItems = { listForOrganization: vi.fn(async () => [workItemDto()]) }
    controller = new WorkItemsController(workItems as unknown as WorkItemsService)
  })

  it('list answers 401 without a verified session', async () => {
    await expect(controller.handleList(requestWith(undefined), undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    expect(workItems.listForOrganization).not.toHaveBeenCalled()
  })

  it('list answers 400 when the session has no active organization', async () => {
    await expect(
      controller.handleList(requestWith({ ...SESSION, activeOrganizationId: null }), undefined),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(workItems.listForOrganization).not.toHaveBeenCalled()
  })

  it('list returns the active organization work items as-is', async () => {
    const listed = await controller.handleList(requestWith(SESSION), undefined)

    expect(workItems.listForOrganization).toHaveBeenCalledWith({
      organizationId: 'org_compai',
    })
    expect(listed).toEqual([workItemDto()])
  })

  it('list parses a numeric limit query and passes it through', async () => {
    await controller.handleList(requestWith(SESSION), '25')

    expect(workItems.listForOrganization).toHaveBeenCalledWith({
      organizationId: 'org_compai',
      limit: 25,
    })
  })

  it('list ignores a non-numeric limit query', async () => {
    await controller.handleList(requestWith(SESSION), 'soon')

    expect(workItems.listForOrganization).toHaveBeenCalledWith({
      organizationId: 'org_compai',
    })
  })
})
