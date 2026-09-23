import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import {
  SandboxTokenGuard,
  type SandboxAuthenticatedRequest,
} from '../../platform/sandboxes/sandbox-token.guard'
import { pullRequestNumberOf } from './pull-requests.controller'
import { PullRequestsService, type PullRequestDto } from './pull-requests.service'

/**
 * The serve process inside a sandbox holds only its thread-scoped sandbox token, so it cannot
 * call the session-guarded route — this twin resolves the same user principal off the sandbox
 * row and answers the identical read. The per-user repo-access check inside the service is
 * unchanged: the token only ever names the user the sandbox was minted for.
 */
@Controller({ path: 'sandboxes/github/prs', version: '1' })
@UseGuards(SandboxTokenGuard)
export class SandboxPullRequestsController {
  constructor(private readonly pullRequests: PullRequestsService) {}

  @Get()
  handleRead(
    @Req() request: SandboxAuthenticatedRequest,
    @Query('repo') repo: string,
    @Query('branch') branch: string | undefined,
    @Query('number') number: string | undefined,
  ): Promise<PullRequestDto | null> {
    const sandbox = request.sandbox
    if (!sandbox) throw new UnauthorizedException('a valid sandbox session token is required')
    if (branch !== undefined && number !== undefined) {
      throw new BadRequestException('pass branch or number, not both')
    }
    if (number !== undefined) {
      return this.pullRequests.readByNumber({
        userId: sandbox.userId,
        repoFullName: repo,
        number: pullRequestNumberOf(number),
      })
    }
    if (branch === undefined) {
      throw new BadRequestException('pass branch or number')
    }
    return this.pullRequests.readByBranch({
      userId: sandbox.userId,
      repoFullName: repo,
      branch,
    })
  }
}
