import { ForbiddenException, Injectable } from '@nestjs/common'
import { EFactorySurface, type WorkItemDto } from '../factory.types'
import {
  GithubSurfaceService,
  type IssueCommentSummary,
  type IssueSummary,
  type PullRequestSummary,
} from '../reply/github-surface.service'
import { orchestratedItem } from '../stations/station-lookup'
import { WorkItemsService } from '../work-items.service'

type RepoIssue = { owner: string; repo: string; number: number }

@Injectable()
export class FactoryGithubToolsService {
  constructor(
    private readonly workItems: WorkItemsService,
    private readonly surface: GithubSurfaceService,
  ) {}

  async getIssue(args: RepoIssue & { threadId: string }): Promise<IssueSummary> {
    await orchestratedItem({ threadId: args.threadId })
    return this.surface.getIssue(coordsOf(args))
  }

  async getIssueComments(
    args: RepoIssue & { threadId: string },
  ): Promise<IssueCommentSummary[]> {
    await orchestratedItem({ threadId: args.threadId })
    return this.surface.getIssueComments(coordsOf(args))
  }

  async getPullRequest(args: RepoIssue & { threadId: string }): Promise<PullRequestSummary> {
    await orchestratedItem({ threadId: args.threadId })
    return this.surface.getPullRequest(coordsOf(args))
  }

  async getPullRequestDiff(args: RepoIssue & { threadId: string }): Promise<{ diff: string }> {
    await orchestratedItem({ threadId: args.threadId })
    const diff = await this.surface.getPullRequestDiff(coordsOf(args))
    return { diff }
  }

  async closeIssue(args: RepoIssue & { threadId: string; body: string }): Promise<{ url: string }> {
    const item = await orchestratedItem({ threadId: args.threadId })
    await this.requireIssueAlias({ item, surfaceId: issueSurfaceIdOf(args) })
    return this.surface.closeIssue({ ...coordsOf(args), body: args.body })
  }

  async addLabel(args: RepoIssue & { threadId: string; label: string }): Promise<void> {
    const item = await orchestratedItem({ threadId: args.threadId })
    await this.requireIssueAlias({ item, surfaceId: issueSurfaceIdOf(args) })
    return this.surface.addLabel({ ...coordsOf(args), label: args.label })
  }

  async removeLabel(args: RepoIssue & { threadId: string; label: string }): Promise<void> {
    const item = await orchestratedItem({ threadId: args.threadId })
    await this.requireIssueAlias({ item, surfaceId: issueSurfaceIdOf(args) })
    return this.surface.removeLabel({ ...coordsOf(args), label: args.label })
  }

  private async requireIssueAlias(args: {
    item: WorkItemDto
    surfaceId: string
  }): Promise<void> {
    const aliases = await this.workItems.listAliases({ workItemId: args.item.id })
    const linked = aliases.some(
      (alias) => alias.surface === EFactorySurface.GitHub && alias.externalId === args.surfaceId,
    )
    if (!linked) {
      throw new ForbiddenException(
        `github surface ${args.surfaceId} is not a surface of this work item`,
      )
    }
  }
}

const coordsOf = (args: RepoIssue): { owner: string; repo: string; number: number } => ({
  owner: args.owner,
  repo: args.repo,
  number: args.number,
})

const issueSurfaceIdOf = (args: RepoIssue): string =>
  `${args.owner}/${args.repo}#${args.number}`
