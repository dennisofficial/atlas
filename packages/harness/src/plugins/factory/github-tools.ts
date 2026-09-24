import { EToolEffect, type ToolDefinition } from '@dltech/atlas-core'
import { z } from 'zod'

import type { FactoryClient } from './client'
import { FactoryTool } from './factory-tool'

const refSchema = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int(),
})

class GithubGetIssueTool extends FactoryTool<typeof refSchema> {
  readonly name = 'github_get_issue'
  readonly description = 'Read a GitHub issue: title, body, state, and labels.'
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = refSchema

  protected override call({ input }: { input: z.output<typeof refSchema> }): Promise<unknown> {
    return this.client.githubIssue(input)
  }
}

class GithubGetCommentsTool extends FactoryTool<typeof refSchema> {
  readonly name = 'github_get_comments'
  readonly description = 'Read the comment thread on a GitHub issue or pull request.'
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = refSchema

  protected override call({ input }: { input: z.output<typeof refSchema> }): Promise<unknown> {
    return this.client.githubComments(input)
  }
}

class GithubGetPullRequestTool extends FactoryTool<typeof refSchema> {
  readonly name = 'github_get_pull_request'
  readonly description = 'Read a GitHub pull request: title, body, state, and review status.'
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = refSchema

  protected override call({ input }: { input: z.output<typeof refSchema> }): Promise<unknown> {
    return this.client.githubPullRequest(input)
  }
}

class GithubGetDiffTool extends FactoryTool<typeof refSchema> {
  readonly name = 'github_get_diff'
  readonly description = 'Read the full diff of a GitHub pull request.'
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = refSchema

  protected override call({ input }: { input: z.output<typeof refSchema> }): Promise<unknown> {
    return this.client.githubDiff(input)
  }
}

const closeIssueSchema = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int(),
  body: z.string().min(1),
})

class GithubCloseIssueTool extends FactoryTool<typeof closeIssueSchema> {
  readonly name = 'github_close_issue'
  readonly description = [
    'Close a GitHub issue.',
    'The body is required and is posted as the closing comment - never close an issue silently.',
  ].join(' ')
  readonly effect = EToolEffect.Write
  readonly inputSchema = closeIssueSchema

  protected override call({ input }: { input: z.output<typeof closeIssueSchema> }): Promise<unknown> {
    return this.client.githubCloseIssue(input)
  }
}

const labelSchema = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int(),
  label: z.string().min(1),
})

class GithubAddLabelTool extends FactoryTool<typeof labelSchema> {
  readonly name = 'github_add_label'
  readonly description = 'Add a label to a GitHub issue or pull request.'
  readonly effect = EToolEffect.Write
  readonly inputSchema = labelSchema

  protected override call({ input }: { input: z.output<typeof labelSchema> }): Promise<unknown> {
    return this.client.githubAddLabel(input)
  }
}

class GithubRemoveLabelTool extends FactoryTool<typeof labelSchema> {
  readonly name = 'github_remove_label'
  readonly description = 'Remove a label from a GitHub issue or pull request.'
  readonly effect = EToolEffect.Write
  readonly inputSchema = labelSchema

  protected override call({ input }: { input: z.output<typeof labelSchema> }): Promise<unknown> {
    return this.client.githubRemoveLabel(input)
  }
}

export const githubTools = (args: { client: FactoryClient }): readonly ToolDefinition[] => [
  new GithubGetIssueTool(args.client),
  new GithubGetCommentsTool(args.client),
  new GithubGetPullRequestTool(args.client),
  new GithubGetDiffTool(args.client),
  new GithubCloseIssueTool(args.client),
  new GithubAddLabelTool(args.client),
  new GithubRemoveLabelTool(args.client),
]
