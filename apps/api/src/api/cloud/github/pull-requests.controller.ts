import {
  BadRequestException,
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

export const pullRequestNumberOf = (raw: string | undefined): number => {
  const number = Number(raw)
  if (raw === undefined || !Number.isInteger(number) || number <= 0) {
    throw new BadRequestException('number must be a positive integer')
  }
  return number
}

@Controller({ path: 'github/prs', version: '1' })
@UseGuards(SessionAuthGuard)
export class PullRequestsController {
  constructor(private readonly pullRequests: PullRequestsService) {}

  @Get()
  handleRead(
    @Req() request: AuthenticatedRequest,
    @Query('repo') repo: string,
    @Query('branch') branch: string | undefined,
    @Query('number') number: string | undefined,
  ): Promise<PullRequestDto | null> {
    const auth = request.auth
    if (!auth) throw new UnauthorizedException('a valid session is required')
    if (branch !== undefined && number !== undefined) {
      throw new BadRequestException('pass branch or number, not both')
    }
    if (number !== undefined) {
      return this.pullRequests.readByNumber({
        userId: auth.userId,
        repoFullName: repo,
        number: pullRequestNumberOf(number),
      })
    }
    if (branch === undefined) {
      throw new BadRequestException('pass branch or number')
    }
    return this.pullRequests.readByBranch({ userId: auth.userId, repoFullName: repo, branch })
  }
}
