import {
  EToolEffect,
  SchemaTool,
  type ToolOutcome,
  type ToolRun,
  EContentAccess,
  EPathForm,
  EPathPresence,
  type DeclaredPathField,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { enterByName, enterByPath, provenanceIn } from './worktree-plan'

const inputSchema = z.strictObject({
  name: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
})

const description = [
  'Create a git worktree and move the session into it.',
  'Use it when the operator asks for a worktree, the project instructions say work happens in one, or your agent contract calls for one.',
  'A request to fix something or start a branch is not by itself a request for a worktree.',
  'name creates a new worktree under .atlas/worktrees of the repository, on a new branch of that name.',
  'Git cuts that branch from a freshly fetched origin default branch.',
  'path enters a worktree that already exists, given as an absolute path or relative to the project directory.',
  'The path must name a worktree git already lists for this repository.',
  'It cannot name the main checkout, a worktree that is bare or prunable, or a worktree on a detached HEAD.',
  'Entering that way adopts a worktree Atlas did not create.',
  'The reply reports the branch, its upstream branch, and what is uncommitted in the worktree.',
  'exit_worktree will not remove it, however it is called.',
  'name and path are mutually exclusive.',
  'A new worktree cannot be created while the session is already in one.',
  'A sub-agent whose contract calls for its own worktree creates it with git worktree add, then adopts it here by path.',
  'You can start the sub-agent with agent_spawn worktree instead.',
  'While the session is in a worktree, that worktree is the project directory.',
  'A path you pass to a tool resolves against it.',
  'A bash command starts there.',
  'The instruction files are re-read from it.',
  'The repository this worktree came from stays checked out where it was.',
  'Leave it alone.',
  'exit_worktree leaves the worktree, and keeps or removes it as the operator asks.',
  'worktree_list shows the worktrees that exist.',
].join(' ')

export class EnterWorktreeTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'enter_worktree'
  readonly description = description
  readonly effect = EToolEffect.Destructive
  readonly inputSchema = inputSchema

  override readonly pathFields: readonly DeclaredPathField[] = [
    {
      field: 'path',
      presence: EPathPresence.Optional,
      form: EPathForm.Absolute,
      content: EContentAccess.Amends,
    },
  ]

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  protected override async run({
    input,
    projectDirectory,
    activeWorktree,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    if (input.name !== undefined && input.path !== undefined) {
      return {
        ok: false,
        reason: 'name creates a worktree and path enters one that exists. Pass exactly one of them',
      }
    }
    if (input.name === undefined && input.path === undefined) {
      return {
        ok: false,
        reason: 'pass name to create a worktree, or path to enter one that exists',
      }
    }

    const provenance = provenanceIn(this.ctx.events())
    const plan =
      input.path === undefined
        ? await enterByName({
            worktrees: this.ctx.worktrees,
            projectDirectory,
            activeWorktree,
            name: input.name ?? '',
          })
        : await enterByPath({
            worktrees: this.ctx.worktrees,
            projectDirectory,
            activeWorktree,
            path: input.path,
            createdHere: (path) => provenance(path).created,
            baseHere: (path) => provenance(path).base,
          })

    return plan.ok
      ? { ok: true, output: { enteredWorktree: plan.entry }, modelText: plan.text }
      : { ok: false, reason: plan.reason }
  }
}
