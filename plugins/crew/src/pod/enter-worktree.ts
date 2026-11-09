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
import type { V2Event } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { enterByName, enterByPath } from './worktree-plan'

const inputSchema = z.strictObject({
  name: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
})

const spawnedInto =
  (events: readonly V2Event[]) =>
  (path: string): boolean =>
    events.some((event) => event.type === 'agent-spawned' && event.worktree?.path === path)

const description = [
  'Create a git worktree and move the session into it.',
  'Use it when the developer asks for a worktree, the project instructions say work happens in one, or your agent contract calls for one; a request to fix something or start a branch is not by itself a request for a worktree.',
  'name creates a new worktree on a new branch of that name, cut from a freshly fetched origin default branch, under .atlas/worktrees of the repository.',
  'path enters a worktree that already exists instead, given absolutely or relative to the project directory, and must name one git already lists for this repository - not its main checkout, not one that is bare or prunable, and not one on a detached HEAD.',
  'Entering that way adopts a worktree Atlas did not create: the reply reports the branch, its upstream, and what is uncommitted there, and exit_worktree will not remove it however it is called.',
  'The two are mutually exclusive, and a new worktree cannot be created while the session is already in one. A sub-agent whose contract calls for its own worktree creates it with git worktree add and adopts it here by path, or is spawned with agent_spawn worktree.',
  'While the session is in a worktree that worktree is the project directory: paths you pass to a tool resolve against it, a bash command starts there, and the instruction files are re-read from it.',
  'The repository this worktree came from stays checked out where it was; leave that checkout alone.',
  'exit_worktree leaves, keeping or removing the worktree as the developer asks, and worktree_list shows what exists.',
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
        reason:
          'name creates a worktree and path enters one that exists, so pass exactly one of them',
      }
    }
    if (input.name === undefined && input.path === undefined) {
      return {
        ok: false,
        reason: 'pass name to create a worktree, or path to enter one that exists',
      }
    }

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
            path: input.path,
            createdHere: spawnedInto(this.ctx.events()),
          })

    return plan.ok
      ? { ok: true, output: { enteredWorktree: plan.entry }, modelText: plan.text }
      : { ok: false, reason: plan.reason }
  }
}
