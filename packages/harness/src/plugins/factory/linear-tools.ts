import { EToolEffect, type ToolDefinition } from '@dltech/atlas-core'
import { z } from 'zod'

import type { FactoryClient } from './client'
import { FactoryTool } from './factory-tool'

const issueSchema = z.strictObject({
  issueId: z.string().min(1),
})

class LinearGetIssueTool extends FactoryTool<typeof issueSchema> {
  readonly name = 'linear_get_issue'
  readonly description = 'Read a Linear issue: title, description, state, and labels.'
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = issueSchema

  protected override call({ input }: { input: z.output<typeof issueSchema> }): Promise<unknown> {
    return this.client.linearIssue(input)
  }
}

const commentSchema = z.strictObject({
  issueId: z.string().min(1),
  body: z.string().min(1),
})

class LinearCommentTool extends FactoryTool<typeof commentSchema> {
  readonly name = 'linear_comment'
  readonly description = 'Post a comment on a Linear issue.'
  readonly effect = EToolEffect.Write
  readonly inputSchema = commentSchema

  protected override call({ input }: { input: z.output<typeof commentSchema> }): Promise<unknown> {
    return this.client.linearComment(input)
  }
}

const setStateSchema = z.strictObject({
  issueId: z.string().min(1),
  stateName: z.string().min(1),
})

class LinearSetStateTool extends FactoryTool<typeof setStateSchema> {
  readonly name = 'linear_set_state'
  readonly description = 'Move a Linear issue to another workflow state, named as it appears in Linear.'
  readonly effect = EToolEffect.Write
  readonly inputSchema = setStateSchema

  protected override call({ input }: { input: z.output<typeof setStateSchema> }): Promise<unknown> {
    return this.client.linearSetState(input)
  }
}

const markDuplicateSchema = z.strictObject({
  issueId: z.string().min(1),
  duplicateOfId: z.string().min(1),
})

class LinearMarkDuplicateTool extends FactoryTool<typeof markDuplicateSchema> {
  readonly name = 'linear_mark_duplicate'
  readonly description = 'Mark a Linear issue as a duplicate of another issue.'
  readonly effect = EToolEffect.Write
  readonly inputSchema = markDuplicateSchema

  protected override call({ input }: { input: z.output<typeof markDuplicateSchema> }): Promise<unknown> {
    return this.client.linearMarkDuplicate(input)
  }
}

export const linearTools = (args: { client: FactoryClient }): readonly ToolDefinition[] => [
  new LinearGetIssueTool(args.client),
  new LinearCommentTool(args.client),
  new LinearSetStateTool(args.client),
  new LinearMarkDuplicateTool(args.client),
]
