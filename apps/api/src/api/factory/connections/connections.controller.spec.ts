import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import type { FactoryConnectionDto } from '../factory.types'
import { FactoryConnectionsController } from './connections.controller'
import type { FactoryConnectionsService } from './connections.service'

function requestWith(auth: AuthenticatedRequest['auth']): AuthenticatedRequest {
  return { auth } as unknown as AuthenticatedRequest
}

function connectionDto(overrides: Partial<FactoryConnectionDto> = {}): FactoryConnectionDto {
  return {
    id: 'fco_1',
    organizationId: 'org_compai',
    provider: 'github',
    externalAccountId: '87123',
    sealedCredentials: null,
    scopes: 'read,write',
    status: 'active',
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

describe('FactoryConnectionsController', () => {
  let connections: { listForOrganization: ReturnType<typeof vi.fn> }
  let controller: FactoryConnectionsController

  beforeEach(() => {
    connections = { listForOrganization: vi.fn(async () => [connectionDto()]) }
    controller = new FactoryConnectionsController(
      connections as unknown as FactoryConnectionsService,
    )
  })

  it('list answers 401 without a verified session', async () => {
    await expect(controller.handleList(requestWith(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    expect(connections.listForOrganization).not.toHaveBeenCalled()
  })

  it('list answers 400 when the session has no active organization', async () => {
    await expect(
      controller.handleList(requestWith({ ...SESSION, activeOrganizationId: null })),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(connections.listForOrganization).not.toHaveBeenCalled()
  })

  it('list returns the active organization connections', async () => {
    const listed = await controller.handleList(requestWith(SESSION))

    expect(connections.listForOrganization).toHaveBeenCalledWith({
      organizationId: 'org_compai',
    })
    expect(listed).toEqual([
      {
        id: 'fco_1',
        provider: 'github',
        externalAccountId: '87123',
        scopes: 'read,write',
        status: 'active',
        createdAt: '2026-09-22T00:00:00.000Z',
        updatedAt: '2026-09-22T00:00:00.000Z',
      },
    ])
  })

  it('list never exposes sealed credentials, even when a row has them', async () => {
    connections.listForOrganization.mockResolvedValue([
      connectionDto({ sealedCredentials: 'sealed-blob' }),
    ])

    const listed = await controller.handleList(requestWith(SESSION))

    expect(listed[0]).not.toHaveProperty('sealedCredentials')
    expect(listed[0]).not.toHaveProperty('organizationId')
  })
})
