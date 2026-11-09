import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext, WorktreeRecord } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

const inputSchema = z.strictObject({})

const description = [
  'List the git worktrees of the repository the session is in, with the branch each one is on.',
  'The main checkout is marked, as is whichever worktree the session is standing in.',
  'Read it before entering a worktree by path, or to tell the developer what work is already laid out.',
].join(' ')

const lineFor = (args: { record: WorktreeRecord; current: string }): string => {
  const marks = [
    args.record.isMain ? 'main checkout' : undefined,
    args.record.path === args.current ? 'this session' : undefined,
    args.record.prunable ? 'prunable' : undefined,
  ].filter((mark): mark is string => mark !== undefined)

  const branch = args.record.branch ?? 'detached HEAD'
  return `${args.record.path} on ${branch}${marks.length === 0 ? '' : ` (${marks.join(', ')})`}`
}

export class WorktreeListTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'worktree_list'
  readonly description = description
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({
    projectDirectory,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    try {
      const listing = await this.ctx.worktrees.list({ cwd: projectDirectory })
      return {
        ok: true,
        output: {
          repository: listing.repository,
          current: projectDirectory,
          worktrees: listing.worktrees.map((record) => ({
            path: record.path,
            branch: record.branch,
            isMain: record.isMain,
          })),
        },
        modelText: listing.worktrees
          .map((record) => lineFor({ record, current: projectDirectory }))
          .join('\n'),
      }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }
}
