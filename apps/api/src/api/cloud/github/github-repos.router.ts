import {
  githubBranchListSchema,
  githubBranchesInputSchema,
  githubRepoListSchema,
  type GithubBranchesInput,
  type GithubRepoSummary,
} from '@dltech/atlas-wire'
import { BadGatewayException, NotFoundException } from '@nestjs/common'
import { Ctx, Input, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { EGithubCallSource } from './github-call-log'
import { GithubRepoReads } from './github-repo-reads'
import { GithubUserReadFailed } from './github-user-reads'
import { GithubService } from './github.service'

@Router({ alias: 'githubRepos' })
@UseMiddlewares(SessionMiddleware)
export class GithubReposRouter {
  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubRepoReads,
  ) {}

  @Query({ output: githubRepoListSchema })
  async list(@Ctx() ctx: SessionTrpcCtx): Promise<GithubRepoSummary[]> {
    const token = await this.tokenOf(ctx)
    try {
      return await this.reads.listRepos({ source: EGithubCallSource.RepoList, token })
    } catch {
      throw new BadGatewayException('github could not list repositories')
    }
  }

  @Query({ input: githubBranchesInputSchema, output: githubBranchListSchema })
  async branches(
    @Input() input: GithubBranchesInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<string[]> {
    const token = await this.tokenOf(ctx)
    try {
      return await this.reads.listBranches({
        source: EGithubCallSource.RepoList,
        token,
        owner: input.owner,
        repo: input.repo,
      })
    } catch (failure) {
      if (failure instanceof GithubUserReadFailed && failure.status === 404) {
        throw new NotFoundException('repository not found')
      }
      throw new BadGatewayException('github could not list branches')
    }
  }

  private async tokenOf(ctx: SessionTrpcCtx): Promise<string> {
    const token = await this.github.findToken({ userId: ctx.auth.userId })
    if (token === undefined) throw new NotFoundException('github is not connected')
    return token
  }
}
