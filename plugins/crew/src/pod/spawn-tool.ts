import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import {
  CREW_AGENT_TYPES,
  SUB_AGENT_CONTRACT,
  crewAgentTypeOf,
  spawnPromptOf,
  type RepoAgentType,
} from '../core'
import { crewRefusal } from './outcome'
import { discoverRepoAgentTypes, repoAgentTypeOf } from './repo-agent-types'
import { planTarget, provenanceIn } from './worktree-plan'

const inputSchema = z.strictObject({
  agentType: z.string().min(1),
  intent: z.string().min(1),
  brief: z.string().min(1),
  worktree: z.string().min(1).optional(),
})

const knownTypes = CREW_AGENT_TYPES.map((type) => type.name).join(', ')

const description = [
  'Start a sub-agent that works in the background and hands you its answer the moment it stops.',
  `agentType is one of ${knownTypes}, or an agent type defined in the repository (listed in the system prompt); intent is a few words naming what it is for;`,
  'brief is the whole task, because the sub-agent sees nothing of this conversation.',
  'worktree puts the child in a git worktree before its first turn: a name creates a new branch and a worktree cut from the fetched origin default branch, and a path to a worktree git already lists adopts it instead.',
].join(' ')

const unknownTypeRefusal = async (args: {
  ctx: PluginPodContext
  projectDirectory: string
  name: string
}): Promise<string> => {
  const found = await discoverRepoAgentTypes({
    ctx: args.ctx,
    projectDirectory: args.projectDirectory,
  })
  const repoTypes = found.types.map((type) => type.name)
  const others =
    repoTypes.length === 0 ? '' : `, or a type defined in this repository: ${repoTypes.join(', ')}`
  return `there is no agent type "${args.name}"; known types are ${knownTypes}${others}`
}

export class AgentSpawnTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'agent_spawn'
  readonly description = description
  readonly effect = EToolEffect.Write
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly ctx: PluginPodContext) {
    super()
  }

  private async promptFor(args: {
    projectDirectory: string
    agentType: string
    brief: string
  }): Promise<{ prompt: string } | { refusal: string }> {
    const builtIn = crewAgentTypeOf(args.agentType)
    if (builtIn !== undefined) {
      return { prompt: spawnPromptOf({ contract: builtIn.contract, brief: args.brief }) }
    }

    const repoType: RepoAgentType | undefined = await repoAgentTypeOf({
      ctx: this.ctx,
      projectDirectory: args.projectDirectory,
      name: args.agentType,
    })
    if (repoType === undefined) {
      return {
        refusal: await unknownTypeRefusal({
          ctx: this.ctx,
          projectDirectory: args.projectDirectory,
          name: args.agentType,
        }),
      }
    }

    return {
      prompt: spawnPromptOf({
        contract: SUB_AGENT_CONTRACT,
        prompt: repoType.prompt,
        brief: args.brief,
      }),
    }
  }

  protected override async run({
    input,
    projectDirectory,
    activeWorktree,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const planned = await this.promptFor({
      projectDirectory,
      agentType: input.agentType,
      brief: input.brief,
    })
    if ('refusal' in planned) return { ok: false, reason: planned.refusal }

    const provenance = provenanceIn(this.ctx.events())
    const target =
      input.worktree === undefined
        ? undefined
        : await planTarget({
            worktrees: this.ctx.worktrees,
            projectDirectory,
            activeWorktree,
            createdHere: () => false,
            baseHere: (path) => provenance(path).base,
            target: input.worktree,
          })
    if (target !== undefined && !target.ok) return { ok: false, reason: target.reason }

    try {
      const snapshot = await this.ctx.crew.spawn({
        agentType: input.agentType,
        intent: input.intent,
        prompt: planned.prompt,
        ...(target === undefined ? {} : { worktree: target.entry }),
      })
      return {
        ok: true,
        output: {
          agentId: snapshot.agentId,
          agentType: snapshot.agentType,
          intent: snapshot.intent,
          ...(snapshot.worktree === undefined ? {} : { worktree: snapshot.worktree }),
        },
        modelText: [
          'Started a sub-agent.',
          `${snapshot.agentId}  ${snapshot.agentType}  ${snapshot.intent}`,
          ...(target === undefined
            ? []
            : [`It works in ${target.entry.path} on branch ${target.entry.branch}.`]),
          'It runs in the background, and hands you its answer the moment it stops.',
        ].join('\n'),
      }
    } catch (error) {
      return crewRefusal(error)
    }
  }
}
