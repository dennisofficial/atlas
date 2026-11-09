import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { CREW_AGENT_TYPES, crewAgentTypeOf } from '../core'
import { crewRefusal } from './outcome'
import { planTarget } from './worktree-plan'

const inputSchema = z.strictObject({
  agentType: z.string().min(1),
  intent: z.string().min(1),
  brief: z.string().min(1),
  worktree: z.string().min(1).optional(),
})

const knownTypes = CREW_AGENT_TYPES.map((type) => type.name).join(', ')

const description = [
  'Start a sub-agent that works in the background and hands you its answer the moment it stops.',
  `agentType is one of ${knownTypes}; intent is a few words naming what it is for;`,
  'brief is the whole task, because the sub-agent sees nothing of this conversation.',
  'worktree puts the child in a git worktree before its first turn: a name creates a new branch and a worktree cut from the fetched origin default branch, and a path to a worktree git already lists adopts it instead.',
].join(' ')

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

  protected override async run({
    input,
    projectDirectory,
    activeWorktree,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const type = crewAgentTypeOf(input.agentType)
    if (type === undefined) {
      return {
        ok: false,
        reason: `there is no agent type "${input.agentType}"; known types are ${knownTypes}`,
      }
    }
    const planned =
      input.worktree === undefined
        ? undefined
        : await planTarget({
            worktrees: this.ctx.worktrees,
            projectDirectory,
            activeWorktree,
            target: input.worktree,
          })
    if (planned !== undefined && !planned.ok) return { ok: false, reason: planned.reason }

    try {
      const snapshot = await this.ctx.crew.spawn({
        agentType: input.agentType,
        intent: input.intent,
        prompt: `${type.contract}\n\n${input.brief}`,
        ...(planned === undefined ? {} : { worktree: planned.entry }),
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
          ...(planned === undefined
            ? []
            : [`It works in ${planned.entry.path} on branch ${planned.entry.branch}.`]),
          'It runs in the background, and hands you its answer the moment it stops.',
        ].join('\n'),
      }
    } catch (error) {
      return crewRefusal(error)
    }
  }
}
