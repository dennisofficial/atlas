import {
  EWorktreeExit,
  EToolEffect,
  SchemaTool,
  TOUCHES_PATHS_IT_CANNOT_NAME,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext, WorktreeState } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

const inputSchema = z.strictObject({
  action: z.enum(EWorktreeExit),
  discardChanges: z.boolean().optional(),
})

const description = [
  'Leave the worktree the session is in.',
  "The session returns to the repository's main checkout.",
  'keep leaves the worktree and its branch on disk, so the session can come back to them.',
  'remove deletes both.',
  'remove only touches a worktree that Atlas created with enter_worktree name or agent_spawn worktree.',
  'A worktree that the session entered by path, or was launched inside, already existed.',
  'Atlas leaves it on disk whichever action is asked for.',
  'The operator removes it.',
  'Call it only when the operator asks to leave.',
  'Never call it on your own initiative.',
  'Never call it to tidy up after finishing the work.',
  'A remove is refused in three cases.',
  'The worktree holds uncommitted changes.',
  'The worktree holds commits that are on neither its upstream nor the ref the branch was cut from.',
  'Atlas cannot tell what is not pushed.',
  'The refusal names what would be lost.',
  'discardChanges forces that removal.',
  'Ask the operator before you set it.',
  'Do not decide for the operator.',
  'When the session is not in a worktree, this does nothing and says so.',
  'Every file stays where it is.',
].join(' ')

const lostFilesOf = (state: WorktreeState): string => {
  const more = state.changedCount - state.changedPaths.length
  return `${state.changedCount} uncommitted ${state.changedCount === 1 ? 'file' : 'files'} (${state.changedPaths.join(', ')}${more > 0 ? `, and ${more} more` : ''})`
}

const removeRefusalOf = (args: { path: string; state: WorktreeState }): string | undefined => {
  const { path, state } = args
  if (state.changedCount > 0) {
    return `removing the worktree at ${path} would lose ${lostFilesOf(state)}. Tell the operator what is in the worktree and let them decide. They can commit and push it, exit with keep instead, or ask you to call this again with discardChanges set.`
  }
  if (state.unpushed === null) {
    return `removing the worktree at ${path} cannot tell what is not pushed from here, so it needs the approval of the operator. Tell them the worktree holds no uncommitted changes. With no upstream branch or base branch Atlas cannot count the commits it would lose. Call again with discardChanges set if they agree it should go.`
  }
  const { count, against } = state.unpushed
  if (count > 0) {
    return `removing the worktree at ${path} would lose ${count} ${count === 1 ? 'commit that is' : 'commits that are'} not on ${against}. Tell the operator what is in the worktree and let them decide. They can push it, exit with keep instead, or ask you to call this again with discardChanges set.`
  }
  return undefined
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export class ExitWorktreeTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'exit_worktree'
  readonly description = description
  readonly effect = EToolEffect.Destructive
  readonly inputSchema = inputSchema
  override readonly pathFields = TOUCHES_PATHS_IT_CANNOT_NAME

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({
    input,
    projectDirectory,
    homeDirectory,
    activeWorktree,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    if (activeWorktree === undefined) {
      return {
        ok: true,
        output: { exited: false },
        modelText: `The session is not in a worktree - it is in ${projectDirectory} - so nothing was left and nothing was removed.`,
      }
    }

    const path = activeWorktree.path
    const returnTo = await this.repositoryOf({ cwd: path, homeDirectory })
    const landing = `The project directory is now ${returnTo}, the repository's main checkout.`

    if (input.action === EWorktreeExit.Keep) {
      return {
        ok: true,
        output: { exitedWorktree: { path, action: EWorktreeExit.Keep, returnTo } },
        modelText: `Left the worktree at ${path}, which stays on disk with its branch. ${landing}`,
      }
    }

    if (activeWorktree.adopted) {
      return {
        ok: true,
        output: { exitedWorktree: { path, action: EWorktreeExit.Keep, returnTo } },
        modelText: `Left the worktree at ${path}. Atlas did not create it - the session entered one that already existed - so it stays on disk with its branch and nothing was removed. Tell the operator that. Let them remove it if they want it gone. ${landing}`,
      }
    }

    if (input.discardChanges !== true) {
      let state: WorktreeState
      try {
        state = await this.ctx.worktrees.inspect({
          cwd: path,
          ...(activeWorktree.base === undefined ? {} : { base: activeWorktree.base }),
        })
      } catch (error) {
        return { ok: false, reason: messageOf(error) }
      }
      const refusal = removeRefusalOf({ path, state })
      if (refusal !== undefined) return { ok: false, reason: refusal }
    }

    try {
      const removal = await this.ctx.worktrees.remove({
        cwd: returnTo,
        path,
        branch: activeWorktree.branch,
        force: input.discardChanges === true,
      })
      const branchNote =
        removal.branchDeleted === false
          ? ` The branch ${removal.branch ?? ''} could not be deleted, so it is still there.`
          : ''
      return {
        ok: true,
        output: { exitedWorktree: { path, action: EWorktreeExit.Remove, returnTo } },
        modelText: `Removed the worktree at ${path} and its branch ${removal.branch ?? ''}.${branchNote} ${landing}`,
      }
    } catch (error) {
      return { ok: false, reason: messageOf(error) }
    }
  }

  private async repositoryOf(args: {
    cwd: string
    homeDirectory: string | undefined
  }): Promise<string> {
    try {
      const listing = await this.ctx.worktrees.list({ cwd: args.cwd })
      return listing.repository
    } catch {
      return args.homeDirectory ?? args.cwd
    }
  }
}
