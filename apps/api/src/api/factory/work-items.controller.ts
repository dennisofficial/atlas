import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common'
import type { AuthenticatedRequest } from '../../_core/types/auth.types'
import { SessionAuthGuard } from '../../_module/session/session-auth.guard'
import type { WorkItemDto } from './factory.types'
import { requireOrganization } from './require-organization'
import { WorkItemsService } from './work-items.service'

@Controller({ path: 'factory/work-items', version: '1' })
@UseGuards(SessionAuthGuard)
export class WorkItemsController {
  constructor(private readonly workItems: WorkItemsService) {}

  @Get()
  async handleList(
    @Req() request: AuthenticatedRequest,
    @Query('limit') limit?: string,
  ): Promise<WorkItemDto[]> {
    const parsed = limit === undefined ? undefined : Number.parseInt(limit, 10)
    return this.workItems.listForOrganization({
      organizationId: requireOrganization(request),
      ...(parsed === undefined || Number.isNaN(parsed) ? {} : { limit: parsed }),
    })
  }
}
