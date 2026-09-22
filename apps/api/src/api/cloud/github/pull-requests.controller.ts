import {
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { PullRequestsService, type PullRequestDto } from './pull-requests.service'

@Controller({ path: 'github/prs', version: '1' })
@UseGuards(SessionAuthGuard)
export class PullRequestsController {
  constructor(private readonly pullRequests: PullRequestsService) {}

  @Get()
  handleRead(
    @Req() request: AuthenticatedRequest,
    @Query('repo') repo: string,
    @Query('branch') branch: string,
  ): Promise<PullRequestDto | null> {
    const auth = request.auth
    if (!auth) throw new UnauthorizedException('a valid session is required')
    return this.pullRequests.readByBranch({ userId: auth.userId, repoFullName: repo, branch })
  }
}
