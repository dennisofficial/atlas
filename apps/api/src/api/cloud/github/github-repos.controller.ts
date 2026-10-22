import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { GITHUB_REPO_PATTERN } from '@dltech/atlas-wire'
import type { GithubRepoSummary } from '@dltech/atlas-wire'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { SessionAuthGuard } from '../../../_module/session/session-auth.guard'
import { GithubRepoReads } from './github-repo-reads'
import { GithubUserReadFailed } from './github-user-reads'
import { GithubService } from './github.service'

function userIdOf(request: AuthenticatedRequest): string {
  const auth = request.auth
  if (!auth) throw new UnauthorizedException('a valid session is required')
  return auth.userId
}

@Controller({ path: 'github/repos', version: '1' })
@UseGuards(SessionAuthGuard)
export class GithubReposController {
  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubRepoReads,
  ) {}

  @Get()
  async handleList(@Req() request: AuthenticatedRequest): Promise<GithubRepoSummary[]> {
    const token = await this.tokenOf(request)
    try {
      return await this.reads.listRepos({ token })
    } catch {
      throw new BadGatewayException('github could not list repositories')
    }
  }

  @Get(':owner/:repo/branches')
  async handleBranches(
    @Req() request: AuthenticatedRequest,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
  ): Promise<string[]> {
    if (!GITHUB_REPO_PATTERN.test(`${owner}/${repo}`)) {
      throw new BadRequestException('owner and repo must name a github repository')
    }
    const token = await this.tokenOf(request)
    try {
      return await this.reads.listBranches({ token, owner, repo })
    } catch (failure) {
      if (failure instanceof GithubUserReadFailed && failure.status === 404) {
        throw new NotFoundException('repository not found')
      }
      throw new BadGatewayException('github could not list branches')
    }
  }

  private async tokenOf(request: AuthenticatedRequest): Promise<string> {
    const token = await this.github.findToken({ userId: userIdOf(request) })
    if (token === undefined) throw new NotFoundException('github is not connected')
    return token
  }
}
