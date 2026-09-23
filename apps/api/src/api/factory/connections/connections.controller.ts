import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import type { FactoryConnectionDto } from '../factory.types'
import { requireOrganization } from '../require-organization'
import { FactoryConnectionsService } from './connections.service'

export type PublicConnectionDto = {
  id: string
  provider: string
  externalAccountId: string
  scopes: string | null
  status: string
  createdAt: string
  updatedAt: string
}

const toPublicConnection = (row: FactoryConnectionDto): PublicConnectionDto => ({
  id: row.id,
  provider: row.provider,
  externalAccountId: row.externalAccountId,
  scopes: row.scopes,
  status: row.status,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

@Controller({ path: 'factory/connections', version: '1' })
@UseGuards(SessionAuthGuard)
export class FactoryConnectionsController {
  constructor(private readonly connections: FactoryConnectionsService) {}

  @Get()
  async handleList(@Req() request: AuthenticatedRequest): Promise<PublicConnectionDto[]> {
    const connections = await this.connections.listForOrganization({
      organizationId: requireOrganization(request),
    })
    return connections.map(toPublicConnection)
  }
}
